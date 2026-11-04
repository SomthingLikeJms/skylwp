use crate::state::Host;
use serde_json::json;
use std::sync::atomic::Ordering;
use tauri::{Emitter, Manager};
use windows::{
    core::{w, Interface, BOOL},
    Win32::{
        Foundation::{COLORREF, HWND, LPARAM, LRESULT, RECT, WPARAM},
        UI::{
            Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass},
            WindowsAndMessaging::*,
        },
    },
};

const DESKTOP_ORDER_GUARD: usize = 0x534b594c;

unsafe fn shared_icons(hwnd: HWND) -> Option<HWND> {
    let parent = GetParent(hwnd).ok()?;
    FindWindowExW(Some(parent), None, w!("SHELLDLL_DefView"), None).ok()
}

unsafe fn below_icons(hwnd: HWND, icons: HWND) -> bool {
    if GetParent(hwnd).ok() != GetParent(icons).ok() {
        return false;
    }
    let mut previous = GetWindow(hwnd, GW_HWNDPREV).ok();
    while let Some(window) = previous {
        if window == icons {
            return true;
        }
        previous = GetWindow(window, GW_HWNDPREV).ok();
    }
    false
}

// The raised Windows 11 desktop shares a parent with the icon view. A later
// ShowWindow/WebView activation can raise our child even though SetParent is
// unchanged. Constrain our own position requests, without touching Explorer.
unsafe extern "system" fn desktop_order_guard(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _id: usize,
    _data: usize,
) -> LRESULT {
    if message == WM_NCDESTROY {
        let _ = RemoveWindowSubclass(hwnd, Some(desktop_order_guard), DESKTOP_ORDER_GUARD);
    }
    let result = DefSubclassProc(hwnd, message, wparam, lparam);
    if message == WM_WINDOWPOSCHANGING && lparam.0 != 0 {
        let position = &mut *(lparam.0 as *mut WINDOWPOS);
        if !position.flags.contains(SWP_NOZORDER) {
            if let Some(icons) = shared_icons(hwnd) {
                position.hwndInsertAfter = icons;
            }
        }
    }
    result
}

unsafe fn protect_icon_order(hwnd: HWND) -> Result<(), String> {
    if !SetWindowSubclass(hwnd, Some(desktop_order_guard), DESKTOP_ORDER_GUARD, 0).as_bool() {
        return Err("无法保护桌面图标层级".into());
    }
    if let Some(icons) = shared_icons(hwnd) {
        SetWindowPos(
            hwnd,
            Some(icons),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER,
        )
        .map_err(|e| format!("无法将壁纸置于图标下方：{e}"))?;
    }
    Ok(())
}

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
        // Install/remove the subclass on the owning UI thread. Interactive mode
        // must be free to become a foreground top-level window again.
        let _ = RemoveWindowSubclass(hwnd, Some(desktop_order_guard), DESKTOP_ORDER_GUARD);
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
                protect_icon_order(hwnd)?;
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
                SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_FRAMECHANGED | SWP_SHOWWINDOW,
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
            // Verify again after showing the child and restoring foreground focus.
            if desk.raised {
                protect_icon_order(hwnd)?;
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
    let request = host.0.mode_request.fetch_add(1, Ordering::Relaxed) + 1;
    let cloned = host.clone();
    host.0
        .app
        .run_on_main_thread(move || {
            if cloned.0.mode_request.load(Ordering::Relaxed) != request {
                return;
            }
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
                let request = host.0.mode_request.load(Ordering::Relaxed);
                let hwnd = HWND(host.0.hwnd.load(Ordering::Relaxed) as *mut _);
                let parent = HWND(host.0.parent.load(Ordering::Relaxed) as *mut _);
                let current = (
                    GetSystemMetrics(SM_CXVIRTUALSCREEN),
                    GetSystemMetrics(SM_CYVIRTUALSCREEN),
                );
                let remount = !IsWindow(Some(parent)).as_bool()
                    || GetParent(hwnd).map(|p| p.0 as isize).unwrap_or(0) != parent.0 as isize
                    || (size != (0, 0) && size != current);
                let order_changed = shared_icons(hwnd)
                    .map(|icons| !below_icons(hwnd, icons))
                    .unwrap_or(false);
                if remount || order_changed {
                    let recovery = host.clone();
                    // A recovery detected during SetParent must not overwrite a
                    // newer user request to open the interactive console.
                    let _ = host.0.app.run_on_main_thread(move || {
                        if recovery.0.mode_request.load(Ordering::Relaxed) == request
                            && !recovery.0.interactive.load(Ordering::Relaxed)
                        {
                            let result = if remount {
                                set_mode(&recovery, false)
                            } else {
                                // Explorer can also reorder its own icon view.
                                // Repair only Z order, not the desktop attachment.
                                let current =
                                    HWND(recovery.0.hwnd.load(Ordering::Relaxed) as *mut _);
                                protect_icon_order(current)
                            };
                            if let Err(error) = result {
                                recovery.log(&error);
                            } else if order_changed {
                                recovery.log("Restored wallpaper below desktop icons");
                            }
                        }
                    });
                }
                size = current;
            }
        }
    });
}
