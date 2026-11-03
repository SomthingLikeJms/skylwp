use std::{os::windows::process::CommandExt, process::Command};
const KEY: &str = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const VALUE: &str = "AsciiCityWallpaper";
pub fn enabled() -> bool {
    Command::new("reg.exe")
        .args(["query", KEY, "/v", VALUE])
        .creation_flags(0x08000000)
        .output()
        .is_ok_and(|v| v.status.success())
}
pub fn set(on: bool) -> Result<(), String> {
    let mut command = Command::new("reg.exe");
    command.creation_flags(0x08000000);
    if on {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        command.args([
            "add",
            KEY,
            "/v",
            VALUE,
            "/t",
            "REG_SZ",
            "/d",
            &format!("\"{}\"", exe.display()),
            "/f",
        ]);
    } else {
        command.args(["delete", KEY, "/v", VALUE, "/f"]);
    }
    let result = command.output().map_err(|e| e.to_string())?;
    if result.status.success() {
        Ok(())
    } else {
        Err("无法修改当前用户的开机启动设置".into())
    }
}
