use super::process_cpu::OwnCpu;
use crate::state::Host;
use serde_json::json;
use std::{
    sync::atomic::Ordering,
    time::{Duration, Instant},
};
use sysinfo::{Networks, System};
use windows::Win32::{
    Foundation::{FILETIME, RECT},
    System::{
        Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS},
        SystemInformation::GetTickCount64,
        Threading::GetSystemTimes,
    },
    UI::{
        Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO},
        WindowsAndMessaging::{
            GetClassNameW, GetForegroundWindow, GetSystemMetrics, GetWindowRect,
            GetWindowThreadProcessId, IsZoomed, SM_CXSCREEN, SM_CYSCREEN, SM_XVIRTUALSCREEN,
            SM_YVIRTUALSCREEN,
        },
    },
};

fn ft(f: FILETIME) -> u64 {
    (f.dwHighDateTime as u64) << 32 | f.dwLowDateTime as u64
}
fn cpu_times() -> Option<(u64, u64)> {
    unsafe {
        let (mut i, mut k, mut u) = (
            FILETIME::default(),
            FILETIME::default(),
            FILETIME::default(),
        );
        GetSystemTimes(Some(&mut i), Some(&mut k), Some(&mut u)).ok()?;
        Some((ft(i), ft(k) + ft(u)))
    }
}

pub fn run(host: Host) {
    let mut system = System::new();
    let mut networks = Networks::new_with_refreshed_list();
    let mut previous = cpu_times();
    let mut last = Instant::now();
    let mut minute = 0;
    let mut own_cpu = OwnCpu::new();
    own_cpu.sample();
    let mut previous_presence = None;
    let mut baseline = 256000.0f64;
    while host.0.running.load(Ordering::Relaxed) {
        std::thread::sleep(Duration::from_secs(1));
        let elapsed = last.elapsed().as_secs_f64().max(0.1);
        last = Instant::now();
        system.refresh_memory();
        networks.refresh(true);
        let bytes: u64 = networks
            .values()
            .map(|n| n.received() + n.transmitted())
            .sum();
        let rate = bytes as f64 / elapsed;
        baseline = baseline.max(rate).max(256000.0);
        baseline = (baseline * 0.9999).max(256000.0);
        let own_ticks = own_cpu.sample();
        if let Some(current) = cpu_times() {
            if let Some(old) = previous {
                let total = current.1.saturating_sub(old.1);
                let idle = current.0.saturating_sub(old.0);
                if total > 0 && host.enabled("system") {
                    host.emit("system","sys.sample",None,json!({"cpu":((total.saturating_sub(idle))as f64/total as f64-own_ticks as f64/total as f64).clamp(0.0,1.0),"mem":system.used_memory() as f64/system.total_memory().max(1)as f64,"net":(rate/baseline).clamp(0.0,1.0)}));
                    host.status("system", "已连接");
                }
            }
            previous = Some(current);
        }
        if !host.enabled("system") {
            host.status("system", "已关闭");
        }
        unsafe {
            let mut input = LASTINPUTINFO {
                cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
                ..Default::default()
            };
            let idle = if GetLastInputInfo(&mut input).as_bool() {
                (GetTickCount64() as u32).wrapping_sub(input.dwTime) / 1000
            } else {
                0
            };
            let hwnd = GetForegroundWindow();
            let mut pid = 0;
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
            let mut class = [0u16; 128];
            let n = GetClassNameW(hwnd, &mut class);
            let name = String::from_utf16_lossy(&class[..n.max(0) as usize]);
            let mut rect = RECT::default();
            let _ = GetWindowRect(hwnd, &mut rect);
            let desktop = ["Progman", "WorkerW", "Shell_TrayWnd", "SHELLDLL_DefView"]
                .contains(&name.as_str());
            let screen_w = GetSystemMetrics(SM_CXSCREEN);
            let screen_h = GetSystemMetrics(SM_CYSCREEN);
            let full = pid != std::process::id()
                && !desktop
                && (IsZoomed(hwnd).as_bool()
                    || (rect.right - rect.left >= screen_w - 2
                        && rect.bottom - rect.top >= screen_h - 2));
            host.0.covered.store(full, Ordering::Relaxed);
            let mut power = SYSTEM_POWER_STATUS::default();
            if GetSystemPowerStatus(&mut power).is_ok() {
                host.0
                    .battery
                    .store(power.ACLineStatus == 0, Ordering::Relaxed);
            }
            let presence = (idle >= 300, full);
            if previous_presence != Some(presence) {
                host.emit(
                    "presence",
                    "presence",
                    None,
                    json!({"idleSec":idle,"fullscreen":full}),
                );
                previous_presence = Some(presence);
            }
            if minute % 60 == 0 {
                let now = chrono::Local::now();
                use chrono::Timelike;
                host.emit("sim","clock.set",None,json!({"hour":now.hour()as f64+now.minute()as f64/60.0+now.second()as f64/3600.0,"flow":"real"}));
            }
            let _ = (
                GetSystemMetrics(SM_XVIRTUALSCREEN),
                GetSystemMetrics(SM_YVIRTUALSCREEN),
            );
        }
        minute += 1;
    }
}
