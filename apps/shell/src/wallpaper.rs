use crate::state::Host;
use serde_json::json;
use std::sync::atomic::Ordering;
use tauri::{Emitter, Manager};
use windows::{
    core::{w, Interface, BOOL},
    Win32::{
        Foundation::{COLORREF, HWND, LPARAM, RECT, WPARAM},
        UI::WindowsAndMessaging::*,
    },
};

#[derive(Default)]
struct Desktop {
    parent: isize,
    icons: isize,
    raised: bool,
}
unsafe extern "system" fn find_desktop(hwnd: HWND, param: LPARAM) -> BOOL {
    let desktop = &mut *(param.0 as *mut Desktop);
    if let Ok(icons) = FindWindowExW(Some(hwnd), None, w!("SHELLDLL_DefView"), None) {
        let raised =
            GetWindowLongPtrW(hwnd, GWL_EXSTYLE) & WS_EX_NOREDIRECTIONBITMAP.0 as isize != 0;
        if raised {
            desktop.parent = hwnd.0 as isize;
            desktop.icons = icons.0 as isize;
            desktop.raised = true;
        } else if let Ok(worker) = FindWindowExW(None, Some(hwnd), w!("WorkerW"), None) {
            desktop.parent = worker.0 as isize;
        }
        if desktop.parent != 0 {
            return false.into();
        }
    }
    true.into()
}
unsafe fn desktop() -> Result<Desktop, String> {
    let progman = FindWindowW(w!("Progman"), None).map_err(|e| e.to_string())?;
    let _ = SendMessageTimeoutW(
        progman,
        0x052c,
        WPARAM(0xD),
        LPARAM(0),
        SMTO_ABORTIFHUNG,
        1000,
        None,
    );
    let _ = SendMessageTimeoutW(
        progman,
        0x052c,
        WPARAM(0xD),
        LPARAM(1),
        SMTO_ABORTIFHUNG,
        1000,
        None,
    );
    let mut found = Desktop::default();
    let _ = EnumWindows(Some(find_desktop), LPARAM(&mut found as *mut _ as isize));
    if found.parent == 0 {
        return Err("找不到 Windows 桌面容器".into());
    }
    Ok(found)
}
pub fn set_mode(host: &Host, interactive: bool) -> Result<(), String> {
    let window = host
        .0
        .app
        .get_webview_window("city")
        .ok_or("壁纸窗口尚未创建")?;
    let raw = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
    let hwnd = HWND(raw as *mut _);
    let was_interactive = host.0.interactive.load(Ordering::Relaxed);
    unsafe {
        if interactive {
            if !was_interactive {
                let previous = GetForegroundWindow();
                if previous != hwnd {
                    host.0
                        .previous_foreground
                        .store(previous.0 as isize, Ordering::Relaxed);
                }
            }
            let _ = SetParent(hwnd, None);
            let style = (GetWindowLongPtrW(hwnd, GWL_STYLE) & !(WS_CHILD.0 as isize))
                | WS_POPUP.0 as isize
                | WS_VISIBLE.0 as isize;
            SetWindowLongPtrW(hwnd, GWL_STYLE, style);
            let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE)
                & !((WS_EX_TRANSPARENT.0 | WS_EX_NOACTIVATE.0 | WS_EX_LAYERED.0) as isize);
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex | WS_EX_TOOLWINDOW.0 as isize);
            let _ = SetWindowPos(
                hwnd,
                Some(HWND_TOPMOST),
                0,
                0,
                GetSystemMetrics(SM_CXSCREEN),
                GetSystemMetrics(SM_CYSCREEN),
                SWP_FRAMECHANGED | SWP_SHOWWINDOW,
            );
            let _ = ShowWindow(hwnd, SW_SHOW);
            let _ = window.set_focus();
            host.0.parent.store(0, Ordering::Relaxed);
        } else {
            let desk = desktop()?;
            let parent = HWND(desk.parent as *mut _);
            let style = (GetWindowLongPtrW(hwnd, GWL_STYLE)
                & !((WS_POPUP.0
                    | WS_CAPTION.0
                    | WS_THICKFRAME.0
                    | WS_SYSMENU.0
                    | WS_MINIMIZEBOX.0
                    | WS_MAXIMIZEBOX.0) as isize))
                | WS_CHILD.0 as isize
                | WS_VISIBLE.0 as isize;
            SetWindowLongPtrW(hwnd, GWL_STYLE, style);
            let mut ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE)
                & !(WS_EX_APPWINDOW.0 as isize
                    | WS_EX_NOREDIRECTIONBITMAP.0 as isize
                    | WS_EX_TOPMOST.0 as isize);
            ex |= (WS_EX_TOOLWINDOW.0 | WS_EX_NOACTIVATE.0 | WS_EX_TRANSPARENT.0) as isize;
            if desk.raised {
                ex |= WS_EX_LAYERED.0 as isize;
            }
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex);
            let _ = SetWindowPos(
                hwnd,
                Some(HWND_NOTOPMOST),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            );
            SetParent(hwnd, Some(parent)).map_err(|e| format!("桌面挂载失败：{e}"))?;
            if desk.raised {
                SetLayeredWindowAttributes(hwnd, COLORREF(0), 255, LWA_ALPHA)
                    .map_err(|e| e.to_string())?;
            }
            let mut bounds = RECT::default();
            let _ = GetWindowRect(parent, &mut bounds);
            let x = GetSystemMetrics(SM_XVIRTUALSCREEN) - bounds.left;
            let y = GetSystemMetrics(SM_YVIRTUALSCREEN) - bounds.top;
            let order = if desk.raised {
                HWND(desk.icons as *mut _)
            } else {
                HWND_BOTTOM
            };
            let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
            SetWindowPos(
                hwnd,
                Some(order),
                x,
                y,
                GetSystemMetrics(SM_CXVIRTUALSCREEN),
                GetSystemMetrics(SM_CYVIRTUALSCREEN),
                SWP_NOACTIVATE | SWP_FRAMECHANGED | SWP_SHOWWINDOW,
            )
            .map_err(|e| e.to_string())?;
            host.0.parent.store(desk.parent, Ordering::Relaxed);
            if was_interactive {
                let previous =
                    HWND(host.0.previous_foreground.swap(0, Ordering::Relaxed) as *mut _);
                if IsWindow(Some(previous)).as_bool() {
                    let _ = SetForegroundWindow(previous);
                }
            }
        }
    }
    host.0.hwnd.store(raw, Ordering::Relaxed);
    host.0.interactive.store(interactive, Ordering::Relaxed);
    let _ = window.with_webview(move |webview| unsafe {
        use webview2_com::Microsoft::Web::WebView2::Win32::{
            ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
            COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
        };
        if let Ok(core) = webview.controller().CoreWebView2() {
            if let Ok(core) = core.cast::<ICoreWebView2_19>() {
                let _ = core.SetMemoryUsageTargetLevel(if interactive {
                    COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL
                } else {
                    COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
                });
            }
        }
    });
    let _ = host.0.app.emit("city:control", host.control_state());
    host.log(&format!(
        "Mode {}",
        if interactive {
            "interactive"
        } else {
            "wallpaper"
        }
    ));
    Ok(())
}
pub fn schedule_mode(host: &Host, interactive: bool) -> Result<(), String> {
    let cloned = host.clone();
    host.0
        .app
        .run_on_main_thread(move || {
            if let Err(error) = set_mode(&cloned, interactive) {
                cloned.log(&error);
                cloned.status("wallpaper", error);
                let _ = cloned.0.app.emit(
                    "city:control",
                    json!({"kind":"error","message":"桌面挂载失败，可从托盘重试"}),
                );
            }
        })
        .map_err(|e| e.to_string())
}
pub fn watchdog(host: Host) {
    std::thread::spawn(move || {
        let mut size = (0, 0);
        while host.0.running.load(Ordering::Relaxed) {
            std::thread::sleep(std::time::Duration::from_secs(5));
            if !host.0.ready.load(Ordering::Relaxed) || host.0.interactive.load(Ordering::Relaxed) {
                continue;
            }
            unsafe {
                let hwnd = HWND(host.0.hwnd.load(Ordering::Relaxed) as *mut _);
                let parent = HWND(host.0.parent.load(Ordering::Relaxed) as *mut _);
                let current = (
                    GetSystemMetrics(SM_CXVIRTUALSCREEN),
                    GetSystemMetrics(SM_CYVIRTUALSCREEN),
                );
                if !IsWindow(Some(parent)).as_bool()
                    || GetParent(hwnd).map(|p| p.0 as isize).unwrap_or(0) != parent.0 as isize
                    || (size != (0, 0) && size != current)
                {
                    let _ = schedule_mode(&host, false);
                }
                size = current;
            }
        }
    });
}
