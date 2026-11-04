use crate::state::Host;
use serde_json::json;
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};
use windows::{
    core::{Interface, Ref, BOOL},
    Win32::{
        Foundation::{CloseHandle, HWND, LPARAM},
        System::{
            Com::SAFEARRAY,
            Com::{CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED},
            Threading::{
                OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
                PROCESS_QUERY_LIMITED_INFORMATION,
            },
            Variant::VARIANT,
        },
        UI::{
            Accessibility::{
                CUIAutomation, IUIAutomation, IUIAutomation2, IUIAutomationElement,
                IUIAutomationStructureChangedEventHandler,
                IUIAutomationStructureChangedEventHandler_Impl, StructureChangeType,
                TreeScope_Children, TreeScope_Descendants, TreeScope_Subtree,
                UIA_ControlTypePropertyId, UIA_TabControlTypeId, UIA_TabItemControlTypeId,
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
#[windows::core::implement(IUIAutomationStructureChangedEventHandler)]
struct StructureSignal {
    dirty: Arc<AtomicBool>,
}
impl IUIAutomationStructureChangedEventHandler_Impl for StructureSignal_Impl {
    fn HandleStructureChangedEvent(
        &self,
        _: Ref<IUIAutomationElement>,
        _: StructureChangeType,
        _: *const SAFEARRAY,
    ) -> windows::core::Result<()> {
        self.dirty.store(true, Ordering::Relaxed);
        Ok(())
    }
}
struct Watch {
    automation: IUIAutomation,
    container: IUIAutomationElement,
    handler: IUIAutomationStructureChangedEventHandler,
    dirty: Arc<AtomicBool>,
    count: i32,
    scanned: Instant,
    audited: Instant,
    subscribed: bool,
    isolated: bool,
    empty_audits: u8,
    retry_after: Instant,
}
impl Drop for Watch {
    fn drop(&mut self) {
        if self.subscribed {
            unsafe {
                let _ = self
                    .automation
                    .RemoveStructureChangedEventHandler(&self.container, &self.handler);
            }
        }
    }
}
unsafe fn watch(
    automation: &IUIAutomation,
    hwnd: isize,
    host: &Host,
) -> windows::core::Result<Watch> {
    let root = automation.ElementFromHandle(HWND(hwnd as *mut _))?;
    let condition = automation.CreatePropertyCondition(
        UIA_ControlTypePropertyId,
        &VARIANT::from(UIA_TabItemControlTypeId.0),
    )?;
    let items = root.FindAll(TreeScope_Descendants, &condition)?;
    let mut count = items.Length()?.clamp(0, 100);
    let mut container = root.clone();
    let mut isolated = false;
    // Subscribe to the tab strip, rather than the changing web document subtree.
    if count > 0 {
        if let (Ok(first), Ok(walker)) = (items.GetElement(0), automation.ControlViewWalker()) {
            let mut candidate = walker.GetParentElement(&first);
            for _ in 0..6 {
                let Ok(parent) = candidate else {
                    break;
                };
                if automation
                    .CompareElements(&parent, &root)
                    .map(|v| v.as_bool())
                    .unwrap_or(false)
                {
                    break;
                }
                let class = parent
                    .CurrentClassName()
                    .map(|v| v.to_string())
                    .unwrap_or_default();
                let tab_strip = !class.ends_with("TabContainerImpl")
                    && (matches!(
                        class.as_str(),
                        "TabStrip"
                            | "TabStripRegionView"
                            | "EdgeTabStrip"
                            | "EdgeTabStripRegionView"
                    ) || parent.CurrentControlType().ok() == Some(UIA_TabControlTypeId)
                        || parent
                            .CurrentAriaRole()
                            .is_ok_and(|role| role.to_string() == "tablist"));
                if tab_strip {
                    if let Ok(length) = parent
                        .FindAll(TreeScope_Descendants, &condition)
                        .and_then(|a| a.Length())
                    {
                        // Edge wraps every individual tab in a Tab control too.
                        // Keep walking to the outer tab strip, including when
                        // the window initially has only one tab.
                        container = parent.clone();
                        count = length.clamp(0, 100);
                        isolated = true;
                    }
                }
                candidate = walker.GetParentElement(&parent);
            }
        }
    }
    let dirty = Arc::new(AtomicBool::new(false));
    let handler: IUIAutomationStructureChangedEventHandler = StructureSignal {
        dirty: dirty.clone(),
    }
    .into();
    let scope = if isolated {
        TreeScope_Subtree
    } else {
        TreeScope_Children
    };
    let subscribed = automation
        .AddStructureChangedEventHandler(&container, scope, None, &handler)
        .is_ok();
    if std::env::args().any(|a| a == "--debug-port") {
        let class = container
            .CurrentClassName()
            .map(|v| v.to_string())
            .unwrap_or_default();
        host.log(&format!("Browser watcher hwnd={hwnd} class={class} tabs={count} isolated={isolated} subscribed={subscribed}"));
    }
    Ok(Watch {
        automation: automation.clone(),
        container,
        handler,
        dirty,
        count,
        scanned: Instant::now(),
        audited: Instant::now(),
        subscribed,
        isolated,
        empty_audits: 0,
        retry_after: Instant::now(),
    })
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
    unsafe {
        if let Ok(options) = automation.cast::<IUIAutomation2>() {
            let _ = options.SetConnectionTimeout(500);
            let _ = options.SetTransactionTimeout(500);
        }
    }
    let mut previous = String::new();
    let mut watches = HashMap::<isize, Watch>::new();
    let mut discovered = Instant::now() - Duration::from_secs(3);
    while host.0.running.load(Ordering::Relaxed) {
        if !host.enabled("browser") {
            watches.clear();
            host.status("browser", "已关闭");
            std::thread::sleep(Duration::from_secs(3));
            continue;
        }
        if chrono::Utc::now().timestamp_millis() - host.0.browser_external.load(Ordering::Relaxed)
            < 90000
        {
            watches.clear();
            host.status("browser", "已连接浏览器扩展");
            std::thread::sleep(Duration::from_secs(3));
            continue;
        }
        if discovered.elapsed() >= Duration::from_secs(2) {
            let mut windows = Vec::<isize>::new();
            unsafe {
                let _ = EnumWindows(Some(enumerate), LPARAM(&mut windows as *mut _ as isize));
            }
            windows.retain(|hwnd| *hwnd != host.0.hwnd.load(Ordering::Relaxed));
            windows.truncate(32);
            watches.retain(|hwnd, _| windows.contains(hwnd));
            for hwnd in windows.into_iter().take(32) {
                if hwnd == host.0.hwnd.load(Ordering::Relaxed) || watches.contains_key(&hwnd) {
                    continue;
                }
                if let Ok(item) = unsafe { watch(&automation, hwnd, &host) } {
                    watches.insert(hwnd, item);
                }
            }
            discovered = Instant::now();
        }
        // A slow audit recovers tab-strip recreation and providers that omit events.
        let stale: Vec<_> = watches
            .iter()
            .filter_map(|(&hwnd, w)| {
                let audit = if w.count == 0 && w.empty_audits < 3 {
                    5
                } else {
                    60
                };
                (Instant::now() >= w.retry_after
                    && ((w.dirty.load(Ordering::Relaxed)
                        && w.scanned.elapsed() >= Duration::from_millis(300))
                        || (w.isolated && w.scanned.elapsed() >= Duration::from_secs(2))
                        || w.audited.elapsed() >= Duration::from_secs(audit)))
                .then_some(hwnd)
            })
            .collect();
        for hwnd in stale {
            let old = watches.get_mut(&hwnd).unwrap();
            // Events only recount the isolated tab strip. Rediscover the root
            // slowly to recover from a browser replacing its tab-strip element.
            let audit = if old.count == 0 && old.empty_audits < 3 {
                5
            } else {
                60
            };
            if old.isolated && old.audited.elapsed() < Duration::from_secs(audit) {
                old.dirty.store(false, Ordering::Relaxed);
                let count = unsafe {
                    automation
                        .CreatePropertyCondition(
                            UIA_ControlTypePropertyId,
                            &VARIANT::from(UIA_TabItemControlTypeId.0),
                        )
                        .and_then(|c| old.container.FindAll(TreeScope_Descendants, &c))
                        .and_then(|items| items.Length())
                };
                match count {
                    Ok(count) => old.count = count.clamp(0, 100),
                    Err(_) => {
                        old.retry_after = Instant::now() + Duration::from_secs(2);
                        old.audited = Instant::now() - Duration::from_secs(60);
                    }
                }
                old.scanned = Instant::now();
            } else {
                let empty_audits = old.empty_audits.saturating_add(1);
                match unsafe { watch(&automation, hwnd, &host) } {
                    Ok(mut item) => {
                        item.empty_audits = if item.count == 0 { empty_audits } else { 0 };
                        watches.insert(hwnd, item);
                    }
                    Err(_) => {
                        old.dirty.store(false, Ordering::Relaxed);
                        old.retry_after = Instant::now() + Duration::from_secs(10);
                    }
                }
            }
        }
        let mut tabs = Vec::new();
        let mut ordered: Vec<_> = watches.iter().collect();
        ordered.sort_by_key(|(hwnd, _)| **hwnd);
        for (&hwnd, item) in ordered {
            for i in 0..item.count {
                if tabs.len() >= 500 {
                    break;
                }
                tabs.push(json!({"id":format!("{hwnd}-{i}"),"cat":"其他"}));
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
        std::thread::sleep(Duration::from_millis(300));
    }
}
