use crate::state::Host;
use serde_json::{json, Value};
use std::{io::Read, sync::atomic::Ordering};
use tiny_http::{Response, Server, StatusCode};

pub fn start(host: Host) -> Result<(), String> {
    let server = Server::http("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = server
        .server_addr()
        .to_ip()
        .ok_or("No loopback port")?
        .port();
    host.0.port.store(port, Ordering::Relaxed);
    let runtime = json!({"v":1,"pid":std::process::id(),"port":port,"token":host.0.token});
    std::fs::write(host.0.data_dir.join("runtime.json"), runtime.to_string())
        .map_err(|e| e.to_string())?;
    std::thread::spawn(move || {
        while host.0.running.load(Ordering::Relaxed) {
            let Some(mut request) = server
                .recv_timeout(std::time::Duration::from_secs(1))
                .ok()
                .flatten()
            else {
                continue;
            };
            if !request.remote_addr().is_some_and(|x| x.ip().is_loopback()) {
                let _ = request.respond(Response::empty(403));
                continue;
            }
            let authorization = request
                .headers()
                .iter()
                .find(|h| h.field.equiv("Authorization"))
                .map(|h| h.value.as_str())
                .unwrap_or("");
            if authorization != format!("Bearer {}", host.0.token) {
                let _ = request.respond(Response::empty(401));
                continue;
            }
            // No CORS headers; only the local native client and explicitly paired extensions can submit.
            let path = request.url().to_owned();
            if request.method().as_str() == "GET" && path == "/status" {
                let _ = request.respond(
                    Response::from_string(host.diagnostics().to_string()).with_header(
                        "Content-Type: application/json"
                            .parse::<tiny_http::Header>()
                            .unwrap(),
                    ),
                );
                continue;
            }
            if request.method().as_str() != "POST"
                || request.body_length().is_some_and(|n| n > 65536)
            {
                let _ = request.respond(Response::empty(400));
                continue;
            }
            let mut body = String::new();
            let _ = request.as_reader().take(65537).read_to_string(&mut body);
            if body.len() > 65536 {
                let _ = request.respond(Response::empty(413));
                continue;
            }
            let Ok(value) = serde_json::from_str::<Value>(&body) else {
                let _ = request.respond(Response::empty(400));
                continue;
            };
            let result = if path == "/event" {
                validate_external(&value).map(|_| {
                    if value["src"] == "browser" {
                        host.0
                            .browser_external
                            .store(chrono::Utc::now().timestamp_millis(), Ordering::Relaxed);
                    }
                    host.publish(value);
                })
            } else if path == "/config" {
                serde_json::from_value::<crate::state::Config>(value)
                    .map_err(|e| e.to_string())
                    .and_then(|config| crate::update_config(&host, config))
            } else if path == "/command" {
                crate::control(&host, value["command"].as_str().unwrap_or(""))
            } else {
                Err("Unknown endpoint".into())
            };
            let (status, payload) = match result {
                Ok(()) => (200, json!({"ok":true})),
                Err(e) => (400, json!({"error":e})),
            };
            let _ = request.respond(
                Response::from_string(payload.to_string()).with_status_code(StatusCode(status)),
            );
        }
    });
    Ok(())
}

pub fn validate_external(v: &Value) -> Result<(), String> {
    if v["v"] != 1
        || !v["ts"].as_i64().is_some_and(|ts| {
            ts > 0 && (chrono::Utc::now().timestamp_millis() - ts).abs() < 86400000
        })
    {
        return Err("Invalid envelope".into());
    }
    let source = v["src"].as_str().unwrap_or("");
    let kind = v["type"].as_str().unwrap_or("");
    if source == "browser" && kind == "browser.tabs" {
        let tabs = v["data"]["tabs"].as_array().ok_or("Missing tabs")?;
        if tabs.len() > 500
            || tabs.iter().any(|tab| {
                tab.as_object()
                    .is_none_or(|o| o.len() != 2 || !o.contains_key("id") || !o.contains_key("cat"))
                    || !tab["id"].as_str().is_some_and(|s| s.len() <= 128)
                    || !["文档", "视频", "社交", "代码", "搜索", "其他"]
                        .contains(&tab["cat"].as_str().unwrap_or(""))
            })
        {
            return Err("Only abstract tab ids and categories are accepted".into());
        }
        return Ok(());
    }
    if !["claude-code", "codex"].contains(&source)
        || !v["session"]
            .as_str()
            .is_some_and(|s| !s.is_empty() && s.len() <= 128)
    {
        return Err("Unsupported source".into());
    }
    let data = v["data"].as_object().ok_or("Invalid data")?;
    let allowed: &[&str] = match kind {
        "agent.session" => &["state", "name"],
        "agent.todo" => &["done", "total", "current"],
        "agent.tool" => &["kind", "ok"],
        "agent.activity" => &["phase"],
        "agent.await" => &["on", "reason"],
        "agent.error" => &["summary"],
        _ => return Err("Unsupported event".into()),
    };
    if data.keys().any(|k| !allowed.contains(&k.as_str())) {
        return Err("Unknown data field".into());
    }
    let text = |key: &str| {
        data.get(key)
            .and_then(Value::as_str)
            .is_some_and(|s| s.chars().count() <= 256)
    };
    let valid = match kind {
        "agent.activity" => {
            ["thinking", "responding"].contains(&v["data"]["phase"].as_str().unwrap_or(""))
        }
        "agent.session" => {
            ["start", "end"].contains(&v["data"]["state"].as_str().unwrap_or("")) && text("name")
        }
        "agent.todo" => {
            v["data"]["done"]
                .as_u64()
                .zip(v["data"]["total"].as_u64())
                .is_some_and(|(d, t)| d <= t && t <= 10000)
                && text("current")
        }
        "agent.tool" => {
            ["read", "edit", "run", "test", "subtask"]
                .contains(&v["data"]["kind"].as_str().unwrap_or(""))
                && (data.get("ok").is_none_or(Value::is_boolean))
        }
        "agent.await" => {
            v["data"]["on"].is_boolean()
                && ["permission", "input"].contains(&v["data"]["reason"].as_str().unwrap_or(""))
        }
        "agent.error" => !data.contains_key("summary") || text("summary"),
        _ => false,
    };
    if valid {
        Ok(())
    } else {
        Err("Invalid event data".into())
    }
}
