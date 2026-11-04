use std::collections::{HashMap, HashSet};
use std::time::{Duration, Instant};
use windows::Win32::{
    Foundation::{CloseHandle, FILETIME, HANDLE},
    System::{
        Diagnostics::ToolHelp::{
            CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
            TH32CS_SNAPPROCESS,
        },
        Threading::{GetProcessTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION},
    },
};

fn ticks(f: FILETIME) -> u64 {
    ((f.dwHighDateTime as u64) << 32) | f.dwLowDateTime as u64
}
fn descendants(root: u32, rows: &[(u32, u32)]) -> HashSet<u32> {
    let mut owned = HashSet::from([root]);
    for _ in 0..12 {
        let before = owned.len();
        for &(pid, parent) in rows {
            if owned.contains(&parent) {
                owned.insert(pid);
            }
        }
        if before == owned.len() {
            break;
        }
    }
    owned
}
struct ProcessClock {
    handle: HANDLE,
    previous: u64,
}
impl Drop for ProcessClock {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.handle);
        }
    }
}
fn process_ticks(handle: HANDLE) -> Option<u64> {
    let (mut created, mut exited, mut kernel, mut user) = (
        FILETIME::default(),
        FILETIME::default(),
        FILETIME::default(),
        FILETIME::default(),
    );
    unsafe {
        GetProcessTimes(handle, &mut created, &mut exited, &mut kernel, &mut user).ok()?;
    }
    if ticks(exited) != 0 {
        return None;
    }
    Some(ticks(kernel) + ticks(user))
}
/// Discover the small owned process tree occasionally; sample only its handles each second.
pub struct OwnCpu {
    clocks: HashMap<u32, ProcessClock>,
    next_discovery: Instant,
}
impl OwnCpu {
    pub fn new() -> Self {
        Self {
            clocks: HashMap::new(),
            next_discovery: Instant::now(),
        }
    }
    pub fn sample(&mut self) -> u64 {
        if Instant::now() >= self.next_discovery {
            unsafe {
                if let Ok(snapshot) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) {
                    let mut rows = Vec::new();
                    let mut entry = PROCESSENTRY32W {
                        dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
                        ..Default::default()
                    };
                    if Process32FirstW(snapshot, &mut entry).is_ok() {
                        loop {
                            rows.push((entry.th32ProcessID, entry.th32ParentProcessID));
                            if Process32NextW(snapshot, &mut entry).is_err() {
                                break;
                            }
                        }
                    }
                    let _ = CloseHandle(snapshot);
                    let owned = descendants(std::process::id(), &rows);
                    self.clocks.retain(|pid, _| owned.contains(pid));
                    for pid in owned {
                        if self.clocks.contains_key(&pid) {
                            continue;
                        }
                        if let Ok(handle) =
                            OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
                        {
                            if let Some(previous) = process_ticks(handle) {
                                self.clocks.insert(pid, ProcessClock { handle, previous });
                            } else {
                                let _ = CloseHandle(handle);
                            }
                        }
                    }
                }
            }
            self.next_discovery = Instant::now() + Duration::from_secs(10);
        }
        let mut delta = 0;
        self.clocks.retain(|_, clock| {
            if let Some(current) = process_ticks(clock.handle) {
                delta += current.saturating_sub(clock.previous);
                clock.previous = current;
                true
            } else {
                false
            }
        });
        delta
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_root_and_transitive_descendants_are_counted() {
        let owned = descendants(7, &[(13, 12), (12, 7), (9, 1), (7, 1), (15, 13)]);
        assert_eq!(owned, HashSet::from([7, 12, 13, 15]));
    }
}
