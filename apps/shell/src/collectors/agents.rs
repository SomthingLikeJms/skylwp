use crate::state::Host;
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    fs::{self, File},
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    sync::atomic::Ordering,
    time::{Duration, Instant, SystemTime},
};

#[derive(Clone, Debug)]
pub struct AgentSignal {
    pub kind: &'static str,
    pub session: String,
    pub data: Value,
}
pub struct Parser {
    base: String,
    source: &'static str,
    session: String,
    active: bool,
    calls: HashMap<String, String>,
    seen: HashSet<String>,
    generation: u64,
}
impl Parser {
    pub fn new(base: String, source: &'static str) -> Self {
        Self {
            session: base.clone(),
            base,
            source,
            active: false,
            calls: HashMap::new(),
            seen: HashSet::new(),
            generation: 0,
        }
    }
    fn start(&mut self, turn: &str, out: &mut Vec<AgentSignal>) {
        self.generation += 1;
        if self.active {
            out.push(AgentSignal {
                kind: "agent.session",
                session: self.session.clone(),
                data: inactive_end(self.name()),
            });
        }
        let turn = if turn == "active" {
            format!("active-{}", self.generation)
        } else {
            turn.chars().take(36).collect()
        };
        self.session = format!("{}:{}", self.base, turn);
        self.active = true;
        self.calls.clear();
        self.seen.clear();
        out.push(AgentSignal {
            kind: "agent.session",
            session: self.session.clone(),
            data: json!({"state":"start","name":self.name()}),
        });
    }
    fn name(&self) -> &str {
        if self.source == "codex" {
            "Codex"
        } else {
            "Claude Code"
        }
    }
    pub fn parse(&mut self, line: &Value) -> Vec<AgentSignal> {
        let mut out = Vec::new();
        if self.source == "codex" {
            let p = &line["payload"];
            let kind = p["type"].as_str().unwrap_or("");
            match (line["type"].as_str().unwrap_or(""), kind) {
                ("event_msg", "task_started") => {
                    self.start(p["turn_id"].as_str().unwrap_or("turn"), &mut out)
                }
                ("event_msg", "task_complete" | "turn_aborted") => {
                    if self.active {
                        if kind == "turn_aborted" {
                            out.push(self.signal("agent.error", json!({})));
                        }
                        out.push(self.signal(
                            "agent.session",
                            if kind == "turn_aborted" {
                                inactive_end(self.name())
                            } else {
                                json!({"state":"end","name":self.name()})
                            },
                        ));
                        self.active = false;
                    }
                }
                ("event_msg", "item_completed") => {
                    let item = &p["item"];
                    let item_kind = item["type"].as_str().unwrap_or("");
                    if matches!(item_kind, "UserMessage" | "ContextCompaction") {
                        return out;
                    }
                    if !self.active {
                        self.start(p["turn_id"].as_str().unwrap_or("active"), &mut out);
                    }
                    let id = item["id"].as_str().unwrap_or("");
                    if !id.is_empty() && !self.seen.insert(id.to_owned()) {
                        return out;
                    }
                    if self.seen.len() > 4096 {
                        self.seen.clear();
                        self.seen.insert(id.to_owned());
                    }
                    match item_kind {
                        "CommandExecution" => {
                            let command = command_text(&item["command"]);
                            let tool = classify("command", &json!({"command":command}));
                            let mut data = json!({"kind":tool});
                            if tool == "test" {
                                if let Some(code) = item["exit_code"].as_i64() {
                                    data["ok"] = json!(code == 0);
                                }
                            }
                            out.push(self.signal("agent.tool", data));
                            if item["exit_code"].as_i64().is_some_and(|n| n != 0) && tool != "test"
                            {
                                out.push(self.signal("agent.error", json!({})));
                            }
                        }
                        "FileChange" => {
                            out.push(self.signal("agent.tool", json!({"kind":"edit"})));
                            if item["status"] == "failed" {
                                out.push(self.signal("agent.error", json!({})));
                            }
                        }
                        "McpToolCall" => {
                            let name = item["tool"].as_str().unwrap_or("");
                            let args = &item["arguments"];
                            if name.contains("request_user_input") {
                                out.push(
                                    self.signal("agent.await", json!({"on":true,"reason":"input"})),
                                );
                            } else if name.ends_with("update_plan") && args["plan"].is_array() {
                                out.push(self.todo(args["plan"].as_array().unwrap()));
                            } else {
                                out.push(
                                    self.signal("agent.tool", json!({"kind":classify(name,args)})),
                                );
                            }
                        }
                        "ImageView" | "WebSearch" | "Extension" => {
                            out.push(self.signal("agent.tool", json!({"kind":"read"})));
                        }
                        "Reasoning" | "AgentMessage" => {
                            out.push(self.signal("agent.activity", json!({"phase":if item_kind=="Reasoning"{"thinking"}else{"responding"}})));
                        }
                        _ => {}
                    }
                }
                ("response_item", "function_call" | "custom_tool_call") => {
                    if !self.active {
                        self.start("active", &mut out);
                    }
                    let name = p["name"].as_str().unwrap_or("");
                    let argument = p
                        .get("arguments")
                        .or_else(|| p.get("input"))
                        .cloned()
                        .unwrap_or(Value::Null);
                    let args = argument
                        .as_str()
                        .and_then(|s| serde_json::from_str::<Value>(s).ok())
                        .unwrap_or(argument.clone());
                    if name == "exec" {
                        // The desktop app wraps calls in JavaScript. Its item_completed
                        // records contain the actual commands/patches; counting the wrapper
                        // would hide file edits and double-count every operation.
                        out.push(self.signal("agent.await", json!({"on":false,"reason":"input"})));
                    } else if name.ends_with("update_plan") {
                        if let Some(plan) = args["plan"].as_array() {
                            out.push(self.todo(plan));
                        }
                    } else if name.contains("request_user_input") {
                        out.push(self.signal("agent.await", json!({"on":true,"reason":"input"})));
                    } else {
                        let tool = classify(name, &args);
                        self.calls
                            .insert(p["call_id"].as_str().unwrap_or("").into(), tool.into());
                        out.push(self.signal("agent.await", json!({"on":false,"reason":"input"})));
                        out.push(self.signal("agent.tool", json!({"kind":tool})));
                    }
                }
                ("response_item", "function_call_output" | "custom_tool_call_output") => {
                    if self.active {
                        let key = p["call_id"].as_str().unwrap_or("");
                        let tool = self.calls.remove(key).unwrap_or("run".into());
                        if let Some(code) = exit_code(&p["output"]) {
                            if tool == "test" {
                                out.push(
                                    self.signal("agent.tool", json!({"kind":"test","ok":code==0})),
                                );
                            } else if code != 0 {
                                out.push(self.signal("agent.error", json!({})));
                            }
                        }
                    }
                }
                ("event_msg", "approval_requested" | "request_user_input") => {
                    if self.active {
                        out.push(self.signal("agent.await",json!({"on":true,"reason":if kind=="approval_requested"{"permission"}else{"input"}})));
                    }
                }
                _ => {}
            }
        } else {
            let kind = line["type"].as_str().unwrap_or("");
            if kind == "user" && is_claude_prompt(line) {
                self.start(line["uuid"].as_str().unwrap_or("turn"), &mut out);
            }
            if kind == "assistant" {
                if let Some(content) = line["message"]["content"].as_array() {
                    for block in content {
                        if block["type"] != "tool_use" {
                            continue;
                        }
                        if !self.active {
                            self.start("active", &mut out);
                        }
                        let name = block["name"].as_str().unwrap_or("");
                        let args = &block["input"];
                        if name == "TodoWrite" {
                            if let Some(todos) = args["todos"].as_array() {
                                out.push(self.todo(todos));
                            }
                        } else {
                            let tool = classify(name, args);
                            self.calls
                                .insert(block["id"].as_str().unwrap_or("").into(), tool.into());
                            out.push(self.signal("agent.tool", json!({"kind":tool})));
                        }
                    }
                }
            }
            if kind == "user" {
                if let Some(content) = line["message"]["content"].as_array() {
                    for block in content {
                        if block["type"] == "tool_result" && self.active {
                            let tool = self
                                .calls
                                .remove(block["tool_use_id"].as_str().unwrap_or(""))
                                .unwrap_or("run".into());
                            if block["is_error"] == true {
                                out.push(self.signal("agent.error", json!({})));
                            } else if tool == "test" {
                                if let Some(code) = exit_code(&line["toolUseResult"]) {
                                    out.push(
                                        self.signal(
                                            "agent.tool",
                                            json!({"kind":"test","ok":code==0}),
                                        ),
                                    );
                                }
                            }
                        }
                    }
                }
            }
            if kind == "system" && line["subtype"] == "turn_duration" && self.active {
                out.push(self.signal("agent.session", json!({"state":"end","name":self.name()})));
                self.active = false;
            }
        }
        out
    }
    fn signal(&self, kind: &'static str, data: Value) -> AgentSignal {
        AgentSignal {
            kind,
            session: self.session.clone(),
            data,
        }
    }
    fn todo(&self, list: &[Value]) -> AgentSignal {
        let done = list.iter().filter(|v| v["status"] == "completed").count();
        let current = list
            .iter()
            .find(|v| v["status"] == "in_progress")
            .and_then(|v| v.get("step").or_else(|| v.get("content")))
            .and_then(Value::as_str)
            .unwrap_or("")
            .chars()
            .take(128)
            .collect::<String>();
        self.signal(
            "agent.todo",
            json!({"done":done,"total":list.len(),"current":current}),
        )
    }
}
fn is_claude_prompt(v: &Value) -> bool {
    v["message"]["content"].is_string()
        || v["message"]["content"].as_array().is_some_and(|a| {
            a.iter().any(|b| b["type"] == "text") && !a.iter().any(|b| b["type"] == "tool_result")
        })
}
fn classify(name: &str, args: &Value) -> &'static str {
    let name = name.to_ascii_lowercase();
    let command = args
        .get("cmd")
        .or_else(|| args.get("command"))
        .and_then(Value::as_str)
        .or_else(|| args.as_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if name.contains("todo") {
        return "read";
    }
    if name.contains("edit")
        || name.contains("write")
        || name.contains("patch")
        || command.contains("tools.apply_patch(")
    {
        return "edit";
    }
    if name.contains("read")
        || name.contains("search")
        || name.contains("glob")
        || name.contains("grep")
        || name.contains("fetch")
    {
        return "read";
    }
    if name.contains("task") || name.contains("spawn_agent") {
        return "subtask";
    }
    if runs_test(&command) {
        return "test";
    }
    if [
        "get-content",
        "select-string",
        "rg ",
        "rg.exe",
        "get-childitem",
        "git diff",
        "git status",
        "read_text(",
    ]
    .iter()
    .any(|s| command.contains(s))
    {
        return "read";
    }
    "run"
}
fn command_text(v: &Value) -> String {
    let Some(args) = v.as_array() else {
        return v.as_str().unwrap_or("").to_owned();
    };
    if let Some(pos) = args.iter().position(|v| {
        v.as_str()
            .is_some_and(|s| ["-Command", "-command", "-c", "/c"].contains(&s))
    }) {
        if let Some(script) = args.get(pos + 1).and_then(Value::as_str) {
            return script.to_owned();
        }
    }
    args.iter()
        .filter_map(Value::as_str)
        .collect::<Vec<_>>()
        .join(" ")
}
fn runs_test(command: &str) -> bool {
    // A search for the text "npm test" is not a test execution. Only a test
    // executable in command position (including a shell chain) qualifies.
    command.split([';', '\n', '\r']).any(|part| {
        let mut words = part
            .trim()
            .trim_start_matches('&')
            .trim()
            .split_whitespace();
        let Some(exe) = words.next() else {
            return false;
        };
        let exe = exe
            .trim_matches(['\'', '"'])
            .rsplit(['\\', '/'])
            .next()
            .unwrap_or("");
        let arg = words.next().unwrap_or("");
        match exe {
            "vitest" | "pytest" | "jest" => true,
            "cargo" | "cargo.exe" | "cargo.ps1" | "dotnet" | "dotnet.exe" => arg == "test",
            "npm" | "npm.cmd" | "pnpm" | "pnpm.cmd" | "yarn" | "yarn.cmd" => {
                arg == "test" || (arg == "run" && words.next() == Some("test"))
            }
            "npx" | "npx.cmd" => ["vitest", "pytest", "jest"].contains(&arg),
            "python" | "python.exe" | "python3" => arg == "-m" && words.next() == Some("pytest"),
            _ => false,
        }
    })
}
fn exit_code(value: &Value) -> Option<i64> {
    if let Some(code) = value
        .get("exit_code")
        .or_else(|| value.get("exitCode"))
        .and_then(Value::as_i64)
    {
        return Some(code);
    }
    if let Some(text) = value.as_str() {
        if let Ok(v) = serde_json::from_str::<Value>(text) {
            return exit_code(&v);
        }
    }
    None
}

struct Tail {
    offset: u64,
    pending: Vec<u8>,
    parser: Parser,
    last_seen: i64,
    touched: Instant,
}
fn needs_read(length: u64, offset: u64) -> bool {
    length != offset
}
fn inactive_end(name: &str) -> Value {
    json!({"state":"end","name":name,"reason":"inactive"})
}
fn collect_files(home: &Path) -> Vec<(PathBuf, &'static str)> {
    let mut paths = Vec::new();
    let sessions = home.join(".codex/sessions");
    // A resumed chat continues writing to the directory of its creation date.
    // Discover only the three known date-directory levels; never read log bodies here.
    let mut directories = vec![sessions];
    for _ in 0..3 {
        let mut next = Vec::new();
        for dir in directories {
            if let Ok(entries) = fs::read_dir(dir) {
                for entry in entries.flatten() {
                    if entry.file_type().is_ok_and(|kind| kind.is_dir()) {
                        next.push(entry.path());
                    }
                }
            }
        }
        directories = next;
    }
    for dir in directories {
        if let Ok(files) = fs::read_dir(dir) {
            for file in files.flatten() {
                if file.path().extension().and_then(|x| x.to_str()) == Some("jsonl") {
                    paths.push((file.path(), "codex"));
                }
            }
        }
    }
    if let Ok(projects) = fs::read_dir(home.join(".claude/projects")) {
        for project in projects.flatten().take(300) {
            if let Ok(files) = fs::read_dir(project.path()) {
                for file in files.flatten() {
                    if file.path().extension().and_then(|x| x.to_str()) == Some("jsonl") {
                        paths.push((file.path(), "claude-code"));
                    }
                }
            }
        }
    }
    // Windows may retain an open log's old mtime. Check record timestamps below.
    paths.sort_by_cached_key(|(p, _)| {
        std::cmp::Reverse(
            p.metadata()
                .and_then(|m| m.modified())
                .unwrap_or(SystemTime::UNIX_EPOCH),
        )
    });
    // Cache each metadata lookup once and bound the files followed by the tailer.
    paths.truncate(128);
    paths
}

pub fn run(host: Host) {
    let home = PathBuf::from(std::env::var_os("USERPROFILE").unwrap_or_default());
    let mut tails = HashMap::<PathBuf, Tail>::new();
    let mut files = Vec::new();
    let mut next_discovery = Instant::now();
    while host.0.running.load(Ordering::Relaxed) {
        if !host.enabled("agents") {
            for tail in tails.values_mut().filter(|t| t.parser.active) {
                host.emit(
                    tail.parser.source,
                    "agent.session",
                    Some(&tail.parser.session),
                    inactive_end(tail.parser.name()),
                );
                tail.parser.active = false;
            }
            host.status("agents", "已关闭");
            tails.clear();
            files.clear();
            next_discovery = Instant::now();
            std::thread::sleep(Duration::from_secs(2));
            continue;
        }
        if Instant::now() >= next_discovery {
            files = collect_files(&home);
            // Keep already active old logs even if Windows retains a stale mtime.
            for (path, tail) in &tails {
                if tail.parser.active && !files.iter().any(|(p, _)| p == path) {
                    files.push((path.clone(), tail.parser.source));
                }
            }
            files.sort_by_key(|(path, _)| !tails.get(path).is_some_and(|t| t.parser.active));
            files.truncate(128);
            next_discovery = Instant::now() + Duration::from_secs(10);
        }
        for (path, source) in &files {
            let source = *source;
            let Ok(metadata) = fs::metadata(path) else {
                continue;
            };
            let new = !tails.contains_key(path);
            if !new && !needs_read(metadata.len(), tails[path].offset) {
                continue;
            }
            let Ok(mut file) = File::open(path) else {
                continue;
            };
            if new {
                let stem = path.file_stem().unwrap_or_default().to_string_lossy();
                let base = if source == "codex" {
                    stem.chars()
                        .rev()
                        .take(36)
                        .collect::<String>()
                        .chars()
                        .rev()
                        .collect()
                } else {
                    stem.chars().take(36).collect()
                };
                tails.insert(
                    path.clone(),
                    Tail {
                        offset: metadata.len().saturating_sub(524288),
                        pending: Vec::new(),
                        parser: Parser::new(base, source),
                        last_seen: 0,
                        touched: Instant::now(),
                    },
                );
            }
            let tail = tails.get_mut(path).unwrap();
            tail.touched = Instant::now();
            if metadata.len() < tail.offset {
                tail.offset = 0;
                tail.pending.clear();
            }
            if file.seek(SeekFrom::Start(tail.offset)).is_err() {
                continue;
            }
            let mut bytes = Vec::new();
            if file.by_ref().take(1048576).read_to_end(&mut bytes).is_err() {
                continue;
            }
            tail.offset += bytes.len() as u64;
            tail.pending.extend(bytes);
            let Some(last_newline) = tail.pending.iter().rposition(|b| *b == b'\n') else {
                if tail.pending.len() > 1048576 {
                    tail.pending.clear();
                }
                continue;
            };
            let data = tail.pending.drain(..=last_newline).collect::<Vec<_>>();
            let lines: Vec<Value> = data
                .split(|b| *b == b'\n')
                .filter_map(|line| serde_json::from_slice(line).ok())
                .collect();
            let start = if new {
                lines
                    .iter()
                    .rposition(|v| {
                        if source == "codex" {
                            v["payload"]["type"] == "task_started"
                        } else {
                            v["type"] == "user" && is_claude_prompt(v)
                        }
                    })
                    .unwrap_or(0)
            } else {
                0
            };
            if new
                && lines
                    .iter()
                    .rev()
                    .filter_map(|v| v["timestamp"].as_str())
                    .find_map(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
                    .is_some_and(|time| {
                        chrono::Utc::now().signed_duration_since(time).num_minutes() > 20
                    })
            {
                continue;
            }
            let finished = new
                && lines[start..].iter().any(|v| {
                    if source == "codex" {
                        v["payload"]["type"] == "task_complete"
                            || v["payload"]["type"] == "turn_aborted"
                    } else {
                        v["type"] == "system" && v["subtype"] == "turn_duration"
                    }
                });
            if finished {
                continue;
            }
            for line in &lines[start..] {
                if let Some(time) = line["timestamp"]
                    .as_str()
                    .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
                {
                    tail.last_seen = time.timestamp();
                }
                for signal in tail.parser.parse(line) {
                    host.emit(source, signal.kind, Some(&signal.session), signal.data);
                }
            }
        }
        let now = chrono::Utc::now().timestamp();
        let active = tails
            .values()
            .filter(|t| t.parser.active && now - t.last_seen < 1200)
            .count();
        let recent = tails.values().map(|t| t.last_seen).max().unwrap_or(0);
        host.status(
            "agents",
            if active > 0 {
                format!(
                    "{} 个会话工作中，{} 秒前收到活动",
                    active,
                    (now - recent).max(0)
                )
            } else {
                "等待 Codex 或 Claude Code 的新任务".into()
            },
        );
        // Stop presenting abandoned sessions as active when the source disappears.
        for tail in tails
            .values_mut()
            .filter(|t| t.parser.active && now - t.last_seen >= 1200)
        {
            host.emit(
                tail.parser.source,
                "agent.session",
                Some(&tail.parser.session),
                inactive_end(tail.parser.name()),
            );
            tail.parser.active = false;
        }
        // Inactive logs that disappeared from discovery do not stay in memory.
        let discovered: HashSet<&PathBuf> = files.iter().map(|(path, _)| path).collect();
        tails.retain(|path, tail| {
            tail.parser.active
                || (discovered.contains(path) && tail.touched.elapsed() < Duration::from_secs(1200))
        });
        // Keep even abandoned active cursors bounded across discovery generations.
        if tails.len() > 128 {
            let mut stale: Vec<_> = tails
                .iter()
                .map(|(p, t)| (p.clone(), t.parser.active, t.touched))
                .collect();
            stale.sort_by_key(|(_, active, time)| (*active, *time));
            for (path, _, _) in stale {
                if tails.len() <= 128 {
                    break;
                }
                if let Some(tail) = tails.remove(&path) {
                    if tail.parser.active {
                        host.emit(
                            tail.parser.source,
                            "agent.session",
                            Some(&tail.parser.session),
                            inactive_end(tail.parser.name()),
                        );
                    }
                }
            }
        }
        std::thread::sleep(Duration::from_secs(2));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn resumed_chats_are_discovered_in_old_date_directories() {
        let root =
            std::env::temp_dir().join(format!("skylwp-agent-discovery-{}", std::process::id()));
        let old = root.join(".codex/sessions/2020/01/02");
        fs::create_dir_all(&old).unwrap();
        let log = old.join("resumed.jsonl");
        fs::write(&log, b"{}\n").unwrap();
        let files = collect_files(&root);
        assert_eq!(files, vec![(log.clone(), "codex")]);
        fs::remove_file(log).unwrap();
        // Only the exact directories created by this test are removed, non-recursively.
        for dir in [
            &old,
            &old.parent().unwrap().to_path_buf(),
            &old.parent().unwrap().parent().unwrap().to_path_buf(),
            &root.join(".codex/sessions"),
            &root.join(".codex"),
            &root,
        ] {
            fs::remove_dir(dir).unwrap();
        }
    }
    #[test]
    fn aborted_or_replaced_turns_are_not_reported_as_task_completion() {
        let mut p = Parser::new("test".into(), "codex");
        p.parse(&json!({"type":"event_msg","payload":{"type":"task_started","turn_id":"a"}}));
        let replaced =
            p.parse(&json!({"type":"event_msg","payload":{"type":"task_started","turn_id":"b"}}));
        assert_eq!(replaced[0].data["reason"], "inactive");
        let aborted = p.parse(&json!({"type":"event_msg","payload":{"type":"turn_aborted"}}));
        assert_eq!(aborted.last().unwrap().data["reason"], "inactive");
    }
    #[test]
    fn unchanged_files_are_not_opened_and_rotation_is_detected() {
        assert!(!needs_read(100, 100));
        assert!(needs_read(101, 100));
        assert!(needs_read(0, 100));
    }
    #[test]
    fn codex_plan_has_real_steps_not_tool_counts() {
        let mut p = Parser::new("test".into(), "codex");
        let start =
            p.parse(&json!({"type":"event_msg","payload":{"type":"task_started","turn_id":"a"}}));
        assert_eq!(start[0].kind, "agent.session");
        let out=p.parse(&json!({"type":"response_item","payload":{"type":"function_call","name":"update_plan","arguments":"{\"plan\":[{\"step\":\"完成\",\"status\":\"completed\"},{\"step\":\"读取\",\"status\":\"in_progress\"}]}"}}));
        assert_eq!(out[0].data["done"], 1);
        assert_eq!(out[0].data["current"], "读取");
    }
    #[test]
    fn unknown_output_never_guesses_test_success() {
        assert_eq!(exit_code(&json!("all looks good")), None);
        assert_eq!(exit_code(&json!({"exit_code":1})), Some(1));
    }
    #[test]
    fn separate_turns_get_distinct_session_ids() {
        let mut p = Parser::new("test".into(), "codex");
        let a =
            p.parse(&json!({"type":"event_msg","payload":{"type":"task_started","turn_id":"a"}}));
        let b =
            p.parse(&json!({"type":"event_msg","payload":{"type":"task_started","turn_id":"b"}}));
        assert_ne!(a[0].session, b.last().unwrap().session);
    }
    #[test]
    fn desktop_items_report_real_edits_commands_and_explicit_test_results() {
        let mut p = Parser::new("desktop".into(), "codex");
        p.parse(&json!({"type":"event_msg","payload":{"type":"task_started","turn_id":"live"}}));
        let wrapped=p.parse(&json!({"type":"response_item","payload":{"type":"custom_tool_call","name":"exec","call_id":"outer","input":"await tools.exec_command(...)"}}));
        assert!(!wrapped.iter().any(|s| s.kind == "agent.tool"));
        let command = json!({"type":"event_msg","payload":{"type":"item_completed","item":{"type":"CommandExecution","id":"cmd1","command":["powershell","-Command","npm test"],"exit_code":1,"status":"failed"}}});
        let test = p.parse(&command);
        assert_eq!(test[0].data, json!({"kind":"test","ok":false}));
        assert!(p.parse(&command).is_empty());
        let edit=p.parse(&json!({"type":"event_msg","payload":{"type":"item_completed","item":{"type":"FileChange","id":"patch1","status":"completed","changes":[{"path":"PRIVATE"}]}}}));
        assert_eq!(edit[0].data, json!({"kind":"edit"}));
        assert!(!edit[0].data.to_string().contains("PRIVATE"));
        let read=p.parse(&json!({"type":"event_msg","payload":{"type":"item_completed","item":{"type":"CommandExecution","id":"cmd2","command":["powershell","-Command","Get-Content app.ts"],"exit_code":0}}}));
        assert_eq!(read[0].data["kind"], "read");
    }
    #[test]
    fn desktop_thinking_is_activity_without_inventing_a_task_plan() {
        let mut p = Parser::new("desktop".into(), "codex");
        let out=p.parse(&json!({"type":"event_msg","payload":{"type":"item_completed","item":{"type":"Reasoning","id":"r1","summary_text":["PRIVATE"]}}}));
        assert_eq!(out[0].kind, "agent.session");
        assert_eq!(out[1].kind, "agent.activity");
        assert_eq!(out[1].data, json!({"phase":"thinking"}));
    }
    #[test]
    fn mentioning_a_test_in_a_search_is_not_a_successful_test() {
        assert!(!runs_test("rg 'npm test' README.md"));
        assert!(!runs_test("get-content docs/pytest.md"));
        assert!(runs_test("$env:path='tools'; npm run test -- --update"));
        assert!(runs_test("& .\\scripts\\cargo.ps1 test --offline"));
        assert_eq!(
            command_text(&json!(["powershell", "-Command", "npm test"])),
            "npm test"
        );
    }
}
