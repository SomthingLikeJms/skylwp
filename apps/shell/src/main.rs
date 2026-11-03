#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod autostart;
mod collectors;
mod server;
mod state;
mod wallpaper;
use serde_json::{json, Value};
use state::{Config, Host};
use std::sync::atomic::Ordering;
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

#[tauri::command]
fn host_boot(host: tauri::State<'_, Host>) -> Value {
    let host = host.inner();
    let config = host.0.config.lock().unwrap().clone();
    let (events, watermark) = host.latest();
    let status = host.diagnostics();
    json!({"config":config,"events":events,"watermark":watermark,"status":status,"autostart":autostart::enabled()})
}
#[tauri::command]
fn host_ready(host: tauri::State<'_, Host>) -> Result<(), String> {
    host.0.ready.store(true, Ordering::Relaxed);
    wallpaper::schedule_mode(&host, false)
}
#[tauri::command]
fn host_command(host: tauri::State<'_, Host>, command: String) -> Result<(), String> {
    control(&host, &command)
}
#[tauri::command]
fn host_config(host: tauri::State<'_, Host>, config: Config) -> Result<(), String> {
    update_config(&host, config)
}
pub fn update_config(host: &Host, config: Config) -> Result<(), String> {
    if !["bund", "nyc", "hk"].contains(&config.scene.as_str())
        || !["harbor", "phosphor", "ink"].contains(&config.theme.as_str())
        || ![7, 9, 12].contains(&config.density)
        || !config.intensity.is_finite()
        || !(0.0..=1.0).contains(&config.intensity)
        || !config.effects.is_finite()
        || !(0.0..=1.0).contains(&config.effects)
        || !["binary", "ascii", "mirror"].contains(&config.water_mode.as_str())
        || !["combined", "cpu", "agent"].contains(&config.water_source.as_str())
        || !config.water_strength.is_finite()
        || !(0.0..=1.0).contains(&config.water_strength)
        || !["load", "real"].contains(&config.weather_mode.as_str())
        || !config.weather_thresholds.valid()
        || !config.widget_positions.valid()
        || config.weather_city.is_empty()
        || config.weather_city.chars().count() > 64
        || config.weather_city.chars().any(char::is_control)
    {
        return Err("设置无效".into());
    }
    *host.0.config.lock().unwrap() = config;
    host.save_config();
    Ok(())
}
#[tauri::command]
fn host_metrics(host: tauri::State<'_, Host>, metrics: Value) {
    if metrics.to_string().len() < 4096 {
        *host.0.metrics.lock().unwrap() = metrics;
    }
}
#[tauri::command]
fn host_status(host: tauri::State<'_, Host>) -> Value {
    host.diagnostics()
}
#[tauri::command]
fn host_export(host: tauri::State<'_, Host>, content: String) -> Result<String, String> {
    if content.len() > 20 * 1024 * 1024 {
        return Err("记录太大".into());
    }
    let dir = host.0.data_dir.join("exports");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!(
        "ascii-city-{}.jsonl",
        chrono::Local::now().format("%Y%m%d-%H%M%S")
    ));
    std::fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(path.display().to_string())
}
pub fn control(host: &Host, command: &str) -> Result<(), String> {
    match command {
        "interactive" => wallpaper::schedule_mode(host, true),
        "wallpaper" => wallpaper::schedule_mode(host, false),
        "toggle" => wallpaper::schedule_mode(host, !host.0.interactive.load(Ordering::Relaxed)),
        "pause" => {
            host.0.manual_pause.store(true, Ordering::Relaxed);
            Ok(())
        }
        "resume" => {
            host.0.manual_pause.store(false, Ordering::Relaxed);
            Ok(())
        }
        "privacy" => {
            let on = {
                let mut c = host.0.config.lock().unwrap();
                c.privacy = !c.privacy;
                c.privacy
            };
            host.save_config();
            let _ = host
                .0
                .app
                .emit("city:control", json!({"kind":"privacy","on":on}));
            Ok(())
        }
        "scene" => {
            let scene = {
                let mut c = host.0.config.lock().unwrap();
                c.scene = match c.scene.as_str() {
                    "bund" => "nyc",
                    "nyc" => "hk",
                    _ => "bund",
                }
                .into();
                c.scene.clone()
            };
            host.save_config();
            host.emit("sim", "world.scene", None, json!({"scene":scene}));
            Ok(())
        }
        "autostart-on" => autostart::set(true),
        "autostart-off" => autostart::set(false),
        "exit" => {
            host.0.running.store(false, Ordering::Relaxed);
            host.log("Exit requested");
            let _ = std::fs::remove_file(host.0.data_dir.join("runtime.json"));
            host.0.app.exit(0);
            Ok(())
        }
        _ => Err("未知控制命令".into()),
    }
}
fn tray(host: &Host) -> tauri::Result<()> {
    let app = &host.0.app;
    let interactive = MenuItem::with_id(app, "interactive", "打开城市控制台", true, None::<&str>)?;
    let wallpaper = MenuItem::with_id(app, "wallpaper", "回到桌面壁纸", true, None::<&str>)?;
    let pause = MenuItem::with_id(app, "pause-toggle", "暂停或继续动画", true, None::<&str>)?;
    let privacy = CheckMenuItem::with_id(
        app,
        "privacy",
        "隐私模式",
        true,
        host.0.config.lock().unwrap().privacy,
        None::<&str>,
    )?;
    let startup = CheckMenuItem::with_id(
        app,
        "autostart",
        "开机启动",
        true,
        autostart::enabled(),
        None::<&str>,
    )?;
    let scene = MenuItem::with_id(app, "scene", "切换城市", true, None::<&str>)?;
    let folder = MenuItem::with_id(app, "folder", "打开数据与日志文件夹", true, None::<&str>)?;
    let exit = MenuItem::with_id(app, "exit", "退出壁纸", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(
        app,
        &[
            &interactive,
            &wallpaper,
            &pause,
            &privacy,
            &scene,
            &startup,
            &folder,
            &separator,
            &exit,
        ],
    )?;
    let mut rgba = vec![0u8; 32 * 32 * 4];
    for (x, y, height, r, g, b) in [
        (5, 5, 22, 242, 179, 91),
        (14, 12, 15, 115, 219, 204),
        (23, 8, 19, 158, 134, 223),
    ] {
        for dx in 0..4 {
            for dy in 0..height {
                let i = ((y + dy) * 32 + x + dx) * 4;
                rgba[i..i + 4].copy_from_slice(&[r, g, b, 255]);
            }
        }
    }
    let host_menu = host.clone();
    let host_click = host.clone();
    TrayIconBuilder::with_id("city-tray")
        .tooltip("ASCII 城市动态壁纸")
        .icon(tauri::image::Image::new_owned(rgba, 32, 32))
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |_, event| {
            let id = event.id.as_ref();
            match id {
                "autostart" => {
                    let _ = autostart::set(!autostart::enabled());
                }
                "pause-toggle" => {
                    let _ = control(
                        &host_menu,
                        if host_menu.0.manual_pause.load(Ordering::Relaxed) {
                            "resume"
                        } else {
                            "pause"
                        },
                    );
                }
                "folder" => {
                    let _ = std::process::Command::new("explorer.exe")
                        .arg(&host_menu.0.data_dir)
                        .spawn();
                }
                _ => {
                    let _ = control(&host_menu, id);
                }
            }
        })
        .on_tray_icon_event(move |_, event| {
            if matches!(
                event,
                TrayIconEvent::DoubleClick {
                    button: MouseButton::Left,
                    ..
                }
            ) {
                let _ = control(&host_click, "interactive");
            }
        })
        .build(app)?;
    Ok(())
}
fn main() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _| {
            if let Some(host) = app.try_state::<Host>() {
                let _ = control(
                    &host,
                    if args.iter().any(|a| a == "--stop") {
                        "exit"
                    } else {
                        "interactive"
                    },
                );
            }
        }))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        if let Some(host) = app.try_state::<Host>() {
                            let command = if shortcut
                                .matches(Modifiers::SUPER | Modifiers::ALT, Code::KeyW)
                                || shortcut.matches(Modifiers::CONTROL | Modifiers::ALT, Code::KeyW)
                            {
                                "toggle"
                            } else if shortcut
                                .matches(Modifiers::SUPER | Modifiers::ALT, Code::KeyP)
                                || shortcut.matches(Modifiers::CONTROL | Modifiers::ALT, Code::KeyP)
                            {
                                "privacy"
                            } else {
                                "scene"
                            };
                            let _ = control(&host, command);
                        }
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            host_boot,
            host_ready,
            host_command,
            host_config,
            host_metrics,
            host_status,
            host_export
        ])
        .setup(|app| {
            if std::env::args().any(|a| a == "--stop") {
                app.handle().exit(0);
                return Ok(());
            }
            let host = Host::new(app.handle().clone());
            app.manage(host.clone());
            host.log("Starting portable wallpaper");
            let mut window =
                WebviewWindowBuilder::new(app, "city", WebviewUrl::App("index.html".into()))
                    .title("ASCII 城市动态壁纸")
                    .visible(false)
                    .decorations(false)
                    .resizable(false)
                    .shadow(false)
                    .skip_taskbar(true)
                    .inner_size(1280.0, 720.0)
                    .data_directory(host.0.data_dir.join("webview"));
            let args: Vec<String> = std::env::args().collect();
            if let Some(i) = args.iter().position(|a| a == "--debug-port") {
                if let Some(port) = args.get(i + 1).and_then(|s| s.parse::<u16>().ok()) {
                    if port >= 1024 {
                        window = window.additional_browser_args(&format!(
                            "--remote-debugging-port={port} --remote-debugging-address=127.0.0.1"
                        ));
                    }
                }
            }
            let window = window.build()?;
            let close_host = host.clone();
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    if close_host.0.running.load(Ordering::Relaxed) {
                        api.prevent_close();
                        let _ = wallpaper::schedule_mode(&close_host, false);
                    }
                }
            });
            tray(&host)?;
            for code in [Code::KeyW, Code::KeyP, Code::KeyS] {
                if let Err(error) = app
                    .global_shortcut()
                    .register(Shortcut::new(Some(Modifiers::SUPER | Modifiers::ALT), code))
                {
                    host.log(&format!("Shortcut unavailable: {error}"));
                    if app
                        .global_shortcut()
                        .register(Shortcut::new(
                            Some(Modifiers::CONTROL | Modifiers::ALT),
                            code,
                        ))
                        .is_ok()
                    {
                        host.status(
                            &format!("快捷键 {:?}", code),
                            format!(
                                "Ctrl+Alt+{}",
                                match code {
                                    Code::KeyW => "W",
                                    Code::KeyP => "P",
                                    _ => "S",
                                }
                            ),
                        );
                    }
                }
            }
            server::start(host.clone()).map_err(std::io::Error::other)?;
            host.flush_loop();
            collectors::start(host.clone());
            wallpaper::watchdog(host);
            Ok(())
        });
    if let Err(error) = builder.run(tauri::generate_context!()) {
        let path = std::env::current_exe()
            .unwrap_or_default()
            .with_file_name("startup-error.txt");
        let _ = std::fs::write(path, error.to_string());
    }
}
