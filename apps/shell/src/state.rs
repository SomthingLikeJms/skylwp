use chrono::{Local, Utc};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, HashMap},
    fs::{self, File, OpenOptions},
    io::Write,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicI64, AtomicIsize, AtomicU16, AtomicU64, Ordering},
        Arc, Mutex,
    },
};
use tauri::{AppHandle, Emitter};

#[derive(Clone, Serialize, Deserialize)]
pub struct WidgetPoint {
    pub x: f64,
    pub y: f64,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct WidgetPositions {
    pub weather: WidgetPoint,
    pub agents: WidgetPoint,
}
impl Default for WidgetPositions {
    fn default() -> Self {
        Self {
            weather: WidgetPoint { x: 0.06, y: 0.03 },
            agents: WidgetPoint { x: 0.06, y: 0.23 },
        }
    }
}
impl WidgetPositions {
    pub fn valid(&self) -> bool {
        [&self.weather, &self.agents].iter().all(|p| {
            p.x.is_finite()
                && p.y.is_finite()
                && (0.0..=1.0).contains(&p.x)
                && (0.0..=1.0).contains(&p.y)
        })
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct WeatherThresholds {
    pub cloud: f64,
    pub rain: f64,
    pub storm: f64,
    pub memory_fog: f64,
    pub response_seconds: f64,
    pub hold_seconds: f64,
}
impl Default for WeatherThresholds {
    fn default() -> Self {
        Self {
            cloud: 0.2,
            rain: 0.45,
            storm: 0.7,
            memory_fog: 0.85,
            response_seconds: 8.0,
            hold_seconds: 5.0,
        }
    }
}
impl WeatherThresholds {
    pub fn valid(&self) -> bool {
        [
            self.cloud,
            self.rain,
            self.storm,
            self.memory_fog,
            self.response_seconds,
            self.hold_seconds,
        ]
        .iter()
        .all(|v| v.is_finite())
            && self.cloud >= 0.0
            && self.cloud < self.rain
            && self.rain < self.storm
            && self.storm <= 1.0
            && (0.0..=1.0).contains(&self.memory_fog)
            && (1.0..=120.0).contains(&self.response_seconds)
            && (0.0..=120.0).contains(&self.hold_seconds)
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Config {
    pub system: bool,
    pub audio: bool,
    pub media: bool,
    pub agents: bool,
    pub browser: bool,
    pub weather: bool,
    pub weather_city: String,
    pub effects: f64,
    pub desktop_fireworks: bool,
    pub water_mode: String,
    pub water_source: String,
    pub water_strength: f64,
    pub weather_mode: String,
    pub weather_thresholds: WeatherThresholds,
    pub widget_positions: WidgetPositions,
    pub privacy: bool,
    pub pause_when_covered: bool,
    pub scene: String,
    pub theme: String,
    pub density: u32,
    pub intensity: f64,
}
impl Default for Config {
    fn default() -> Self {
        Self {
            system: true,
            audio: true,
            media: true,
            agents: true,
            browser: true,
            weather: true,
            weather_city: "system".into(),
            effects: 0.85,
            desktop_fireworks: true,
            water_mode: "ascii".into(),
            water_source: "combined".into(),
            water_strength: 0.25,
            weather_mode: "load".into(),
            weather_thresholds: WeatherThresholds::default(),
            widget_positions: WidgetPositions::default(),
            privacy: false,
            pause_when_covered: true,
            scene: "bund".into(),
            theme: "harbor".into(),
            density: 9,
            intensity: 1.0,
        }
    }
}

pub struct Journal {
    day: String,
    file: Option<File>,
    last_audio: i64,
}
impl Journal {
    fn new() -> Self {
        Self {
            day: String::new(),
            file: None,
            last_audio: 0,
        }
    }
    fn append(&mut self, dir: &std::path::Path, event: &Value) {
        let is_audio = event["type"] == "audio.frame";
        let now = Utc::now().timestamp_millis();
        if is_audio && now - self.last_audio < 1000 {
            return;
        }
        if is_audio {
            self.last_audio = now;
        }
        let day = Local::now().format("%Y-%m-%d").to_string();
        if self.day != day {
            let logs = dir.join("logs");
            let _ = fs::create_dir_all(&logs);
            self.file = OpenOptions::new()
                .create(true)
                .append(true)
                .open(logs.join(format!("{day}.jsonl")))
                .ok();
            self.day = day;
            if let Ok(entries) = fs::read_dir(logs) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.extension().and_then(|x| x.to_str()) != Some("jsonl") {
                        continue;
                    }
                    if let Ok(date) = chrono::NaiveDate::parse_from_str(
                        &entry.file_name().to_string_lossy().replace(".jsonl", ""),
                        "%Y-%m-%d",
                    ) {
                        if Local::now()
                            .date_naive()
                            .signed_duration_since(date)
                            .num_days()
                            > 14
                        {
                            let _ = fs::remove_file(path);
                        }
                    }
                }
            }
        }
        if let Some(file) = &mut self.file {
            let _ = serde_json::to_writer(&mut *file, event);
            let _ = file.write_all(b"\n");
        }
    }
}

pub struct Shared {
    pub app: AppHandle,
    pub data_dir: PathBuf,
    pub token: String,
    pub config: Mutex<Config>,
    pub running: AtomicBool,
    pub ready: AtomicBool,
    pub interactive: AtomicBool,
    pub manual_pause: AtomicBool,
    pub covered: AtomicBool,
    pub battery: AtomicBool,
    pub hwnd: AtomicIsize,
    pub parent: AtomicIsize,
    pub previous_foreground: AtomicIsize,
    pub port: AtomicU16,
    pub browser_external: AtomicI64,
    pub metrics: Mutex<Value>,
    pub media_session: AtomicBool,
    queue: Mutex<Vec<Value>>,
    latest: Mutex<HashMap<String, Value>>,
    statuses: Mutex<BTreeMap<String, String>>,
    journal: Mutex<Journal>,
    counters: Mutex<BTreeMap<String, u64>>,
    sequence: AtomicU64,
}
#[derive(Clone)]
pub struct Host(pub Arc<Shared>);

impl Host {
    pub fn new(app: AppHandle) -> Self {
        let portable = std::env::current_exe()
            .unwrap_or_default()
            .parent()
            .unwrap_or(std::path::Path::new("."))
            .join("data");
        let data_dir = if fs::create_dir_all(&portable).is_ok() {
            portable
        } else {
            PathBuf::from(std::env::var_os("LOCALAPPDATA").unwrap_or_default()).join("AsciiCity")
        };
        let _ = fs::create_dir_all(&data_dir);
        let config = fs::read(data_dir.join("settings.json"))
            .ok()
            .and_then(|b| serde_json::from_slice::<Config>(&b).ok())
            .unwrap_or_default();
        let mut bytes = [0u8; 32];
        rand::rng().fill_bytes(&mut bytes);
        let token = bytes.iter().map(|b| format!("{b:02x}")).collect();
        Self(Arc::new(Shared {
            app,
            data_dir,
            token,
            config: Mutex::new(config),
            running: AtomicBool::new(true),
            ready: AtomicBool::new(false),
            interactive: AtomicBool::new(false),
            manual_pause: AtomicBool::new(false),
            covered: AtomicBool::new(false),
            battery: AtomicBool::new(false),
            hwnd: AtomicIsize::new(0),
            parent: AtomicIsize::new(0),
            previous_foreground: AtomicIsize::new(0),
            port: AtomicU16::new(0),
            browser_external: AtomicI64::new(0),
            media_session: AtomicBool::new(false),
            metrics: Mutex::new(json!({})),
            queue: Mutex::new(Vec::with_capacity(128)),
            latest: Mutex::new(HashMap::new()),
            statuses: Mutex::new(BTreeMap::new()),
            journal: Mutex::new(Journal::new()),
            counters: Mutex::new(BTreeMap::new()),
            sequence: AtomicU64::new(0),
        }))
    }
    pub fn enabled(&self, name: &str) -> bool {
        let c = self.0.config.lock().unwrap();
        match name {
            "system" => c.system,
            "audio" => c.audio,
            "media" => c.media,
            "agents" => c.agents,
            "weather" => c.weather,
            "browser" => c.browser,
            _ => false,
        }
    }
    pub fn emit(&self, src: &str, kind: &str, session: Option<&str>, data: Value) {
        let mut event =
            json!({"v":1,"ts":Utc::now().timestamp_millis(),"src":src,"type":kind,"data":data});
        if let Some(id) = session {
            event["session"] = json!(id);
        }
        self.publish(event);
    }
    pub fn publish(&self, mut event: Value) {
        let kind = event["type"].as_str().unwrap_or("").to_string();
        if self.0.config.lock().unwrap().privacy {
            match kind.as_str() {
                "agent.todo" => {
                    event["data"]["current"] = json!(format!(
                        "步骤 {}/{}",
                        event["data"]["done"], event["data"]["total"]
                    ))
                }
                "agent.error" => {
                    if let Some(data) = event["data"].as_object_mut() {
                        data.remove("summary");
                    }
                }
                "media.track" => {
                    event["data"]["title"] = json!("正在播放");
                    event["data"]["artist"] = json!("");
                }
                _ => {}
            }
        }
        let key = format!(
            "{}/{}/{}",
            event["src"].as_str().unwrap_or(""),
            event["session"].as_str().unwrap_or(""),
            kind
        );
        {
            let mut latest = self.0.latest.lock().unwrap();
            event["seq"] = json!(self.0.sequence.fetch_add(1, Ordering::Relaxed) + 1);
            latest.insert(key, event.clone());
        }
        *self.0.counters.lock().unwrap().entry(kind).or_insert(0) += 1;
        self.0
            .journal
            .lock()
            .unwrap()
            .append(&self.0.data_dir, &event);
        // Keep the short startup interval too. The frontend acknowledges a
        // snapshot watermark and discards only events already in that snapshot.
        {
            let mut queue = self.0.queue.lock().unwrap();
            if queue.len() >= 256 {
                if let Some(i) = queue.iter().position(|e| e["type"] == "audio.frame") {
                    queue.remove(i);
                } else {
                    queue.remove(0);
                }
            }
            queue.push(event);
        }
    }
    pub fn latest(&self) -> (Vec<Value>, u64) {
        let values = self.0.latest.lock().unwrap();
        let watermark = values
            .values()
            .filter_map(|v| v["seq"].as_u64())
            .max()
            .unwrap_or(0);
        let ended: Vec<String> = values
            .values()
            .filter(|v| v["type"] == "agent.session" && v["data"]["state"] == "end")
            .filter_map(|v| v["session"].as_str().map(str::to_owned))
            .collect();
        let mut result: Vec<Value> = values
            .values()
            .filter(|v| {
                v["type"] != "desktop.click"
                    && !v["session"]
                        .as_str()
                        .is_some_and(|s| ended.iter().any(|e| e == s))
            })
            .cloned()
            .collect();
        sort_snapshot(&mut result);
        (result, watermark)
    }
    pub fn status(&self, source: &str, status: impl Into<String>) {
        self.0
            .statuses
            .lock()
            .unwrap()
            .insert(source.to_owned(), status.into());
    }
    pub fn diagnostics(&self) -> Value {
        json!({"version":env!("CARGO_PKG_VERSION"),"pid":std::process::id(),"mode":if self.0.interactive.load(Ordering::Relaxed){"interactive"}else{"wallpaper"},"paused":self.paused(),"manualPause":self.0.manual_pause.load(Ordering::Relaxed),"covered":self.0.covered.load(Ordering::Relaxed),"battery":self.0.battery.load(Ordering::Relaxed),"hwnd":self.0.hwnd.load(Ordering::Relaxed),"parent":self.0.parent.load(Ordering::Relaxed),"sources":*self.0.statuses.lock().unwrap(),"counters":*self.0.counters.lock().unwrap(),"metrics":*self.0.metrics.lock().unwrap(),"config":*self.0.config.lock().unwrap()})
    }
    pub fn paused(&self) -> bool {
        self.0.manual_pause.load(Ordering::Relaxed)
            || (!self.0.interactive.load(Ordering::Relaxed)
                && self.0.covered.load(Ordering::Relaxed)
                && self.0.config.lock().unwrap().pause_when_covered)
    }
    pub fn control_state(&self) -> Value {
        json!({"kind":"state","interactive":self.0.interactive.load(Ordering::Relaxed),"paused":self.paused(),"battery":self.0.battery.load(Ordering::Relaxed),"privacy":self.0.config.lock().unwrap().privacy})
    }
    pub fn save_config(&self) {
        if let Ok(bytes) = serde_json::to_vec_pretty(&*self.0.config.lock().unwrap()) {
            let _ = fs::write(self.0.data_dir.join("settings.json"), bytes);
        }
    }
    pub fn log(&self, message: &str) {
        if let Ok(mut f) = OpenOptions::new()
            .append(true)
            .create(true)
            .open(self.0.data_dir.join("host.log"))
        {
            let _ = writeln!(f, "{} {}", Local::now().to_rfc3339(), message);
        }
    }
    pub fn flush_loop(&self) {
        let host = self.clone();
        std::thread::spawn(move || {
            let mut last = String::new();
            let mut n = 0;
            while host.0.running.load(Ordering::Relaxed) {
                if host.0.ready.load(Ordering::Relaxed) {
                    let events: Vec<Value> = host.0.queue.lock().unwrap().drain(..).collect();
                    if !events.is_empty() {
                        let _ = host.0.app.emit("city:events", events);
                    }
                    let state = host.control_state();
                    let key = state.to_string();
                    if key != last {
                        last = key;
                        let _ = host.0.app.emit("city:control", state);
                    }
                }
                n += 1;
                if n % 60 == 0 {
                    let _ = fs::write(
                        host.0.data_dir.join("status.json"),
                        host.diagnostics().to_string(),
                    );
                }
                std::thread::sleep(std::time::Duration::from_millis(33));
            }
        });
    }
}

fn sort_snapshot(events: &mut [Value]) {
    events.sort_by_key(|v| {
        (
            if v["type"] == "agent.session" { 0 } else { 1 },
            v["ts"].as_i64().unwrap_or(0),
            v["seq"].as_u64().unwrap_or(0),
        )
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn legacy_visual_preferences_survive_new_climate_defaults() {
        let config: Config = serde_json::from_value(json!({"effects":0,"density":7,"weatherCity":"system","widgetPositions":{"weather":{"x":0.72,"y":0.01},"agents":{"x":0.57,"y":0.01}}})).unwrap();
        assert_eq!(config.effects, 0.0);
        assert_eq!(config.density, 7);
        assert_eq!(config.widget_positions.weather.x, 0.72);
        assert_eq!(config.weather_mode, "load");
        assert!(config.weather_thresholds.valid());
        assert!(config.desktop_fireworks);
        let mut thresholds = config.weather_thresholds;
        thresholds.rain = thresholds.cloud;
        assert!(!thresholds.valid());
        thresholds.rain = 0.45;
        thresholds.response_seconds = f64::NAN;
        assert!(!thresholds.valid());
    }
    #[test]
    fn cached_weather_in_the_same_millisecond_keeps_publication_order() {
        let mut events = vec![
            json!({"type":"weather.real","ts":100,"seq":3}),
            json!({"type":"weather.mode","ts":100,"seq":2,"data":{"live":false}}),
            json!({"type":"agent.tool","ts":100,"seq":5}),
            json!({"type":"agent.session","ts":100,"seq":4}),
        ];
        sort_snapshot(&mut events);
        assert_eq!(events[0]["type"], "agent.session");
        assert_eq!(events[1]["type"], "weather.mode");
        assert_eq!(events[2]["type"], "weather.real");
    }
    #[test]
    fn legacy_settings_get_a_visible_widget_layout_and_positions_are_validated() {
        let config: Config =
            serde_json::from_value(json!({"weatherCity":"system","density":9})).unwrap();
        assert!(config.widget_positions.valid());
        assert_eq!(
            config.widget_positions.agents.x,
            config.widget_positions.weather.x
        );
        let mut layout = WidgetPositions::default();
        layout.weather.x = f64::NAN;
        assert!(!layout.valid());
        layout.weather.x = 1.01;
        assert!(!layout.valid());
    }
}
