use windows::{
    core::{w, Interface, BOOL},
    Win32::{
        Foundation::{HWND, LPARAM},
        System::{
            Com::{CoInitializeEx, COINIT_MULTITHREADED},
            Variant::{VariantToInt32, VT_I4},
        },
        UI::{
            Accessibility::{AccessibleObjectFromWindow, IAccessible},
            HiDpi::{SetThreadDpiAwarenessContext, DPI_AWARENESS_CONTEXT},
            WindowsAndMessaging::{
                EnumWindows, FindWindowExW, GetClassNameW, IsWindowVisible, OBJID_CLIENT,
            },
        },
    },
};
unsafe fn name(h: HWND) -> String {
    let mut n = [0; 80];
    let l = GetClassNameW(h, &mut n).max(0) as usize;
    String::from_utf16_lossy(&n[..l])
}
unsafe extern "system" fn collect(h: HWND, p: LPARAM) -> BOOL {
    if ["Progman", "WorkerW"].contains(&name(h).as_str()) {
        if let Ok(v) = FindWindowExW(Some(h), None, w!("SHELLDLL_DefView"), None) {
            if let Ok(l) = FindWindowExW(Some(v), None, w!("SysListView32"), None) {
                (*(p.0 as *mut Vec<isize>)).push(l.0 as isize);
            }
        }
    }
    true.into()
}
fn main() {
    unsafe {
        let args: Vec<String> = std::env::args().collect();
        let x: i32 = args[1].parse().unwrap();
        let y: i32 = args[2].parse().unwrap();
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let mut lists = Vec::<isize>::new();
        let _ = EnumWindows(Some(collect), LPARAM(&mut lists as *mut _ as isize));
        for mode in [-1, -2, -3, -4] {
            SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT(mode as *mut _));
            for list in &lists {
                let hwnd = HWND(*list as *mut _);
                let mut raw = std::ptr::null_mut();
                if let Err(e) = AccessibleObjectFromWindow(
                    hwnd,
                    OBJID_CLIENT.0 as u32,
                    &IAccessible::IID,
                    &mut raw,
                ) {
                    println!("mode={mode} error={e}");
                    continue;
                }
                let a = IAccessible::from_raw(raw);
                match a.accHitTest(x, y) {
                    Ok(v) => println!(
                        "mode={mode} hwnd={list} visible={} vt={} raw={:?} converted={:?}",
                        IsWindowVisible(hwnd).as_bool(),
                        v.Anonymous.Anonymous.vt.0,
                        if v.Anonymous.Anonymous.vt == VT_I4 {
                            Some(v.Anonymous.Anonymous.Anonymous.lVal)
                        } else {
                            None
                        },
                        VariantToInt32(&v)
                    ),
                    Err(e) => println!("mode={mode} hit error={e}"),
                }
            }
        }
    }
}
