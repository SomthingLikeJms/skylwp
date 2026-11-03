use crate::state::Host;
use serde_json::json;
use std::{sync::atomic::Ordering, time::Duration};
use windows::{
    core::BOOL,
    Win32::{
        Foundation::{CloseHandle, HWND, LPARAM},
        System::{
            Com::{CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED},
            Threading::{
                OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
                PROCESS_QUERY_LIMITED_INFORMATION,
            },
            Variant::VARIANT,
        },
        UI::{
            Accessibility::{
                CUIAutomation, IUIAutomation, TreeScope_Descendants, UIA_ControlTypePropertyId,
                UIA_TabItemControlTypeId,
            },
            WindowsAndMessaging::{
                EnumWindows, GetClassNameW, GetWindowThreadProcessId, IsWindowVisible,
            },
        },
    },
};

unsafe extern "system" fn enumerate(hwnd: HWND, parameter: LPARAM) -> BOOL {
    if !IsWindowVisible(hwnd).as_bool() {
        return true.into();
    }
    let mut class = [0u16; 96];
    let n = GetClassNameW(hwnd, &mut class);
    let name = String::from_utf16_lossy(&class[..n.max(0) as usize]);
    if ["Chrome_WidgetWin_1", "MozillaWindowClass"].contains(&name.as_str()) {
        let mut pid = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if let Ok(handle) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
            let mut image = [0u16; 1024];
            let mut length = image.len() as u32;
            if QueryFullProcessImageNameW(
                handle,
                PROCESS_NAME_WIN32,
                windows::core::PWSTR(image.as_mut_ptr()),
                &mut length,
            )
            .is_ok()
            {
                let file = String::from_utf16_lossy(&image[..length as usize]);
                let file = file.rsplit('\\').next().unwrap_or("").to_ascii_lowercase();
                if [
                    "msedge.exe",
                    "chrome.exe",
                    "firefox.exe",
                    "brave.exe",
                    "vivaldi.exe",
                ]
                .contains(&file.as_str())
                {
                    (*(parameter.0 as *mut Vec<isize>)).push(hwnd.0 as isize);
                }
            }
            let _ = CloseHandle(handle);
        }
    }
    true.into()
}
pub fn run(host: Host) {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }
    let automation: Option<IUIAutomation> =
        unsafe { CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER).ok() };
    let Some(automation) = automation else {
        host.status("browser", "可通过浏览器扩展连接");
        return;
    };
    let mut previous = String::new();
    while host.0.running.load(Ordering::Relaxed) {
        if !host.enabled("browser") {
            host.status("browser", "已关闭");
            std::thread::sleep(Duration::from_secs(3));
            continue;
        }
        if chrono::Utc::now().timestamp_millis() - host.0.browser_external.load(Ordering::Relaxed)
            < 90000
        {
            host.status("browser", "已连接浏览器扩展");
            std::thread::sleep(Duration::from_secs(3));
            continue;
        }
        let mut windows = Vec::<isize>::new();
        unsafe {
            let _ = EnumWindows(Some(enumerate), LPARAM(&mut windows as *mut _ as isize));
        }
        let mut tabs = Vec::new();
        unsafe {
            if let Ok(condition) = automation.CreatePropertyCondition(
                UIA_ControlTypePropertyId,
                &VARIANT::from(UIA_TabItemControlTypeId.0),
            ) {
                for hwnd in windows {
                    if hwnd == host.0.hwnd.load(Ordering::Relaxed) {
                        continue;
                    }
                    if let Ok(root) = automation.ElementFromHandle(HWND(hwnd as *mut _)) {
                        if let Ok(items) = root.FindAll(TreeScope_Descendants, &condition) {
                            let count = items.Length().unwrap_or(0).clamp(0, 100);
                            for i in 0..count {
                                tabs.push(json!({"id":format!("{hwnd}-{i}"),"cat":"其他"}));
                            }
                        }
                    }
                }
            }
        }
        let key = serde_json::to_string(&tabs).unwrap_or_default();
        if key != previous {
            previous = key;
            host.emit("browser", "browser.tabs", None, json!({"tabs":tabs}));
        }
        host.status(
            "browser",
            if tabs.is_empty() {
                "等待浏览器标签，扩展可补充类别".into()
            } else {
                format!("已计数 {} 个标签，未读取标题和网址", tabs.len())
            },
        );
        std::thread::sleep(Duration::from_secs(5));
    }
}
