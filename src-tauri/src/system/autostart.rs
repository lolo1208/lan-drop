// 跨平台开机自启动配置管理
// 支持 Windows 注册表、macOS LaunchAgent plist 及 Linux autostart .desktop

#[cfg(target_os = "windows")]
pub fn configure_autostart(enabled: bool) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    use std::process::Command;

    let app_path = std::env::current_exe().map_err(|e| format!("获取程序路径失败: {}", e))?;
    let app_path_str = app_path.to_string_lossy().to_string();
    let value_data = format!("\"{}\"", app_path_str.replace('/', "\\"));

    if enabled {
        let status = Command::new("reg")
            .args([
                "add",
                r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
                "/v",
                "LAN Drop",
                "/t",
                "REG_SZ",
                "/d",
                &value_data,
                "/f",
            ])
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .map_err(|e| format!("执行 reg add 失败: {}", e))?;

        if status.success() {
            log::info!("已成功添加 Windows 开机启动项");
            Ok(())
        } else {
            Err("添加 Windows 开机启动项失败".into())
        }
    } else {
        let status = Command::new("reg")
            .args([
                "delete",
                r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
                "/v",
                "LAN Drop",
                "/f",
            ])
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();

        match status {
            Ok(s) => {
                if s.success() {
                    log::info!("已成功清理 Windows 开机启动项");
                }
                Ok(())
            }
            Err(e) => {
                log::warn!("清理 Windows 开机启动项警告: {}", e);
                Ok(())
            }
        }
    }
}

#[cfg(target_os = "macos")]
pub fn configure_autostart(enabled: bool) -> Result<(), String> {
    let home_dir = dirs::home_dir().ok_or_else(|| "无法获取用户主目录".to_string())?;
    let launch_agents_dir = home_dir.join("Library").join("LaunchAgents");
    let plist_path = launch_agents_dir.join("com.firegames.landrop.plist");

    if enabled {
        let app_path = std::env::current_exe().map_err(|e| format!("获取程序路径失败: {}", e))?;
        let _ = std::fs::create_dir_all(&launch_agents_dir);
        let plist_content = format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.firegames.landrop</string>
    <key>ProgramArguments</key>
    <array>
        <string>{}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>"#,
            app_path.to_string_lossy()
        );
        std::fs::write(&plist_path, plist_content).map_err(|e| format!("写入 plist 失败: {}", e))?;
        log::info!("已成功添加 macOS 开机启动 LaunchAgent: {:?}", plist_path);
    } else {
        if plist_path.exists() {
            let _ = std::fs::remove_file(&plist_path);
            log::info!("已成功清理 macOS 开机启动 LaunchAgent");
        }
    }
    Ok(())
}

#[cfg(target_os = "linux")]
pub fn configure_autostart(enabled: bool) -> Result<(), String> {
    let home_dir = dirs::home_dir().ok_or_else(|| "无法获取用户主目录".to_string())?;
    let autostart_dir = home_dir.join(".config").join("autostart");
    let desktop_path = autostart_dir.join("com.firegames.landrop.desktop");

    if enabled {
        let app_path = std::env::current_exe().map_err(|e| format!("获取程序路径失败: {}", e))?;
        let _ = std::fs::create_dir_all(&autostart_dir);
        let desktop_content = format!(
            r#"[Desktop Entry]
Type=Application
Name=LAN Drop
Exec={}
Terminal=false
X-GNOME-Autostart-enabled=true
"#,
            app_path.to_string_lossy()
        );
        std::fs::write(&desktop_path, desktop_content).map_err(|e| format!("写入 autostart .desktop 失败: {}", e))?;
        log::info!("已成功添加 Linux 开机启动 desktop 项: {:?}", desktop_path);
    } else {
        if desktop_path.exists() {
            let _ = std::fs::remove_file(&desktop_path);
            log::info!("已成功清理 Linux 开机启动 desktop 项");
        }
    }
    Ok(())
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
pub fn configure_autostart(_enabled: bool) -> Result<(), String> {
    Ok(())
}
