use crate::state::Host;
use serde_json::json;
use std::{
    sync::{
        atomic::Ordering,
        mpsc::{sync_channel, SyncSender},
    },
    time::{Duration, Instant},
};
use windows::{
    core::{w, Interface, BOOL},
    Win32::{
        Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, WPARAM},
        System::{
            Com::{CoInitializeEx, COINIT_MULTITHREADED},
            Variant::{VariantToInt32, VT_I4},
        },
        UI::{
            Accessibility::{AccessibleObjectFromWindow, IAccessible},
            HiDpi::{SetThreadDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2},
            Input::KeyboardAndMouse::{GetAsyncKeyState, VK_CONTROL, VK_MENU, VK_SHIFT},
            Input::{
                GetRawInputData, RegisterRawInputDevices, HRAWINPUT, RAWINPUT, RAWINPUTDEVICE,
                RAWINPUTHEADER, RIDEV_INPUTSINK, RID_INPUT,
            },
            WindowsAndMessaging::{
                CreateWindowExW, DefWindowProcW, DispatchMessageW, EnumWindows, FindWindowExW,
                GetAncestor, GetClassNameW, GetMessageW, GetPhysicalCursorPos, GetWindowLongPtrW,
                GetWindowRect, GetWindowThreadProcessId, PostQuitMessage, RegisterClassW,
                SetWindowLongPtrW, TranslateMessage, WindowFromPoint, CREATESTRUCTW, GA_ROOT,
                GWLP_USERDATA, HWND_MESSAGE, MSG, OBJID_CLIENT, WINDOW_EX_STYLE, WINDOW_STYLE,
                WM_DESTROY, WM_INPUT, WM_NCCREATE, WNDCLASSW,
            },
        },
    },
};

#[derive(Clone, Copy)]
struct Press {
    x: i32,
    y: i32,
    time: u32,
    dragged: bool,
}
impl Press {
    fn moved(&mut self, x: i32, y: i32) {
        let dx = x as i64 - self.x as i64;
        let dy = y as i64 - self.y as i64;
        self.dragged |= dx * dx + dy * dy > 36;
    }
    fn is_click(mut self, x: i32, y: i32, time: u32) -> bool {
        self.moved(x, y);
        !self.dragged && time.wrapping_sub(self.time) <= 600
    }
}
struct Click {
    x: i32,
    y: i32,
    at: Instant,
}
unsafe fn class(hwnd: HWND) -> String {
    let mut name = [0u16; 80];
    let n = GetClassNameW(hwnd, &mut name).max(0) as usize;
    String::from_utf16_lossy(&name[..n])
}
unsafe fn desktop_surface(point: POINT) -> bool {
    let hit = WindowFromPoint(point);
    if hit.0.is_null() {
        return false;
    }
    let root = GetAncestor(hit, GA_ROOT);
    let mut pid = 0;
    GetWindowThreadProcessId(hit, Some(&mut pid));
    ["Progman", "WorkerW"].contains(&class(root).as_str())
        && (pid == std::process::id()
            || ["Progman", "WorkerW", "SHELLDLL_DefView", "SysListView32"]
                .contains(&class(hit).as_str()))
}
unsafe fn modifiers() -> bool {
    [VK_CONTROL, VK_MENU, VK_SHIFT]
        .iter()
        .any(|key| GetAsyncKeyState(key.0 as i32) < 0)
}
unsafe extern "system" fn find_icons(hwnd: HWND, parameter: LPARAM) -> BOOL {
    if !["Progman", "WorkerW"].contains(&class(hwnd).as_str()) {
        return true.into();
    }
    if let Ok(view) = FindWindowExW(Some(hwnd), None, w!("SHELLDLL_DefView"), None) {
        if let Ok(list) = FindWindowExW(Some(view), None, w!("SysListView32"), None) {
            *(parameter.0 as *mut HWND) = list;
            return false.into();
        }
    }
    true.into()
}
unsafe fn blank_desktop(point: POINT) -> Result<(), String> {
    if !desktop_surface(point) {
        return Err("not an Explorer desktop surface".into());
    }
    let mut list = HWND::default();
    let _ = EnumWindows(Some(find_icons), LPARAM(&mut list as *mut _ as isize));
    if list.0.is_null() {
        return Err("no Explorer icons window".into());
    }
    let mut raw = std::ptr::null_mut();
    AccessibleObjectFromWindow(list, OBJID_CLIENT.0 as u32, &IAccessible::IID, &mut raw)
        .map_err(|e| format!("Explorer accessibility: {e}"))?;
    let accessible = IAccessible::from_raw(raw);
    // Hit-test the actual icon and label. UIA bounding rectangles also include
    // the blank spacing between desktop icons and incorrectly reject it.
    let child = accessible
        .accHitTest(point.x, point.y)
        .map_err(|e| format!("Explorer hit test: {e}"))?;
    if child.Anonymous.Anonymous.vt != VT_I4 || VariantToInt32(&child).unwrap_or(-1) != 0 {
        return Err("desktop icon or label".into());
    }
    Ok(())
}

fn normalized(x: i32, y: i32, r: RECT) -> Option<(f64, f64)> {
    if r.right <= r.left
        || r.bottom <= r.top
        || x < r.left
        || x >= r.right
        || y < r.top
        || y >= r.bottom
    {
        return None;
    }
    Some((
        (x - r.left) as f64 / (r.right - r.left) as f64,
        (y - r.top) as f64 / (r.bottom - r.top) as f64,
    ))
}

struct RawMouse {
    host: Host,
    sender: SyncSender<Click>,
    origin: Instant,
    press: Option<Press>,
}
impl RawMouse {
    unsafe fn packet(&mut self, input: RAWINPUT) {
        if input.header.dwType != 0 {
            return;
        }
        let mouse = input.data.mouse;
        let flags = mouse.Anonymous.Anonymous.usButtonFlags;
        if flags & 3 == 0 && self.press.is_none() {
            return;
        }
        if !self.host.0.ready.load(Ordering::Relaxed)
            || self.host.0.interactive.load(Ordering::Relaxed)
            || !self.host.0.config.lock().unwrap().desktop_fireworks
        {
            self.press = None;
            return;
        }
        let mut point = POINT::default();
        if GetPhysicalCursorPos(&mut point).is_err() {
            self.press = None;
            return;
        }
        let time = self.origin.elapsed().as_millis() as u32;
        if flags & 1 != 0 {
            self.press = if !modifiers() && desktop_surface(point) {
                Some(Press {
                    x: point.x,
                    y: point.y,
                    time,
                    dragged: false,
                })
            } else {
                None
            };
        }
        if let Some(p) = &mut self.press {
            p.moved(point.x, point.y);
        }
        if flags & 2 != 0 {
            if let Some(p) = self.press.take() {
                if !modifiers() && p.is_click(point.x, point.y, time) {
                    let _ = self.sender.try_send(Click {
                        x: point.x,
                        y: point.y,
                        at: Instant::now(),
                    });
                }
            }
        }
    }
}
unsafe extern "system" fn raw_window(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if message == WM_NCCREATE {
        let create = &*(lparam.0 as *const CREATESTRUCTW);
        SetWindowLongPtrW(hwnd, GWLP_USERDATA, create.lpCreateParams as isize);
    } else if message == WM_INPUT {
        let context = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut RawMouse;
        if !context.is_null() {
            let mut input = RAWINPUT::default();
            let mut bytes = std::mem::size_of::<RAWINPUT>() as u32;
            if GetRawInputData(
                HRAWINPUT(lparam.0 as *mut _),
                RID_INPUT,
                Some(&mut input as *mut _ as *mut _),
                &mut bytes,
                std::mem::size_of::<RAWINPUTHEADER>() as u32,
            ) != u32::MAX
            {
                (*context).packet(input);
            }
        }
    } else if message == WM_DESTROY {
        PostQuitMessage(0);
    }
    DefWindowProcW(hwnd, message, wparam, lparam)
}
unsafe fn raw_mouse_loop(mut context: Box<RawMouse>) -> windows::core::Result<()> {
    SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    let class_name = w!("AsciiCity.RawMouse");
    let class = WNDCLASSW {
        lpfnWndProc: Some(raw_window),
        lpszClassName: class_name,
        ..Default::default()
    };
    RegisterClassW(&class);
    let window = CreateWindowExW(
        WINDOW_EX_STYLE::default(),
        class_name,
        w!(""),
        WINDOW_STYLE::default(),
        0,
        0,
        0,
        0,
        Some(HWND_MESSAGE),
        None,
        None,
        Some(&mut *context as *mut _ as *const _),
    )?;
    RegisterRawInputDevices(
        &[RAWINPUTDEVICE {
            usUsagePage: 1,
            usUsage: 2,
            dwFlags: RIDEV_INPUTSINK,
            hwndTarget: window,
        }],
        std::mem::size_of::<RAWINPUTDEVICE>() as u32,
    )?;
    context.host.status("desktop", "已连接，原始鼠标输入");
    let mut message = MSG::default();
    while GetMessageW(&mut message, None, 0, 0).0 > 0 {
        let _ = TranslateMessage(&message);
        DispatchMessageW(&message);
    }
    Ok(())
}

pub fn run(host: Host) {
    let (sender, receiver) = sync_channel(8);
    let input_host = host.clone();
    host.status("desktop", "正在连接原始鼠标输入");
    std::thread::spawn(move || unsafe {
        let state = Box::new(RawMouse {
            host: input_host.clone(),
            sender,
            origin: Instant::now(),
            press: None,
        });
        if let Err(error) = raw_mouse_loop(state) {
            input_host.status("desktop", format!("桌面输入不可用：{error}"));
        }
    });
    unsafe {
        SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }
    let debug = std::env::args().any(|a| a == "--debug-port");
    let mut last_click = Instant::now() - Duration::from_secs(1);
    while host.0.running.load(Ordering::Relaxed) {
        let Ok(click) = receiver.recv() else {
            return;
        };
        if host.0.interactive.load(Ordering::Relaxed)
            || !host.0.config.lock().unwrap().desktop_fireworks
            || click.at.elapsed() > Duration::from_millis(700)
            || click.at.saturating_duration_since(last_click) < Duration::from_millis(140)
        {
            continue;
        }
        unsafe {
            if let Err(reason) = blank_desktop(POINT {
                x: click.x,
                y: click.y,
            }) {
                if debug {
                    host.log(&format!("Desktop gesture ignored: {reason}"));
                }
                continue;
            }
            let hwnd = HWND(host.0.hwnd.load(Ordering::Relaxed) as *mut _);
            let mut rect = RECT::default();
            if GetWindowRect(hwnd, &mut rect).is_err() {
                continue;
            }
            let Some((x, y)) = normalized(click.x, click.y, rect) else {
                continue;
            };
            host.0.covered.store(false, Ordering::Relaxed);
            host.emit("presence", "desktop.click", None, json!({"x":x,"y":y}));
            last_click = click.at;
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn gestures_reject_drag_even_if_pointer_returns() {
        let mut p = Press {
            x: 100,
            y: 100,
            time: 100,
            dragged: false,
        };
        assert!(p.is_click(103, 102, 250));
        p.moved(120, 120);
        assert!(!p.is_click(100, 100, 300));
        assert!(!Press {
            dragged: false,
            ..p
        }
        .is_click(100, 100, 1000));
    }
    #[test]
    fn physical_coordinates_include_monitor_origin() {
        let rect = RECT {
            left: -1920,
            top: 0,
            right: 1920,
            bottom: 2160,
        };
        assert_eq!(normalized(0, 1080, rect), Some((0.5, 0.5)));
        assert_eq!(normalized(1920, 0, rect), None);
    }
}
