// LAN Drop (内网投送) - 局域网 Master 自更新与热替换模块
// 机制：
// 1. 任何客户端均可作为 Master 机器，在其 "[用户文档]/LAN Drop/Update/" 目录下放置 version.cfg (如 "2.0.1") 与可执行文件 (lan-drop.exe / lan-drop)
// 2. 客户端配置 Master IP 后，启动时及每 30 分钟静默检测，发现版本不符自动下载并执行自替换与无缝重启

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

pub const CURRENT_APP_VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateCheckResult {
    pub status: String, // "latest" | "updating" | "no_master" | "error" | "no_config"
    pub current_version: String,
    pub remote_version: Option<String>,
    pub message: String,
}

#[derive(Debug, Deserialize)]
struct VersionResponse {
    available: bool,
    version: String,
}

/// 解析并规范化用户输入的 Master IP 地址与端口
pub fn normalize_master_url(raw_input: &str) -> Option<(String, u16)> {
    let mut input = raw_input.trim().to_string();
    if input.is_empty() {
        return None;
    }

    // 移除 http:// 或 https:// 前缀
    if input.starts_with("http://") {
        input = input[7..].to_string();
    } else if input.starts_with("https://") {
        input = input[8..].to_string();
    }

    // 移除尾部斜杠与路径
    if let Some(pos) = input.find('/') {
        input = input[..pos].to_string();
    }

    let input = input.trim();
    if input.is_empty() {
        return None;
    }

    // 解析是否携带自定义端口
    if let Some((ip, port_str)) = input.split_once(':') {
        let port = port_str.parse::<u16>().unwrap_or(crate::discovery::DEFAULT_PORT);
        Some((ip.trim().to_string(), port))
    } else {
        Some((input.to_string(), crate::discovery::DEFAULT_PORT))
    }
}

/// 执行检查更新并自动下载替换重启
pub async fn check_and_perform_update(
    app: &AppHandle,
    master_ip_input: &str,
    is_manual: bool,
) -> Result<UpdateCheckResult, String> {
    let (ip, port) = match normalize_master_url(master_ip_input) {
        Some(res) => res,
        None => {
            return if is_manual {
                Ok(UpdateCheckResult {
                    status: "no_config".into(),
                    current_version: CURRENT_APP_VERSION.into(),
                    remote_version: None,
                    message: "请先输入局域网 Master 机器的 IP 地址".into(),
                })
            } else {
                Ok(UpdateCheckResult {
                    status: "no_config".into(),
                    current_version: CURRENT_APP_VERSION.into(),
                    remote_version: None,
                    message: String::new(),
                })
            };
        }
    };

    let version_url = format!("http://{}:{}/api/update/version", ip, port);
    let download_url = format!("http://{}:{}/api/update/download", ip, port);

    log::info!("正在请求 Master 更新版本信息: {}", version_url);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .connect_timeout(std::time::Duration::from_secs(3))
        .build()
        .map_err(|e| format!("创建网络客户端失败: {}", e))?;

    // 1. 获取 Master 端的 version.cfg 信息
    let version_resp = match client.get(&version_url).send().await {
        Ok(resp) if resp.status().is_success() => {
            resp.json::<VersionResponse>().await.ok()
        }
        Ok(resp) => {
            log::warn!("Master 端响应异常状态码: {}", resp.status());
            None
        }
        Err(e) => {
            log::warn!("无法连接 Master 机器 [{}]: {}", version_url, e);
            None
        }
    };

    let version_info = match version_resp {
        Some(info) => info,
        None => {
            return if is_manual {
                Ok(UpdateCheckResult {
                    status: "error".into(),
                    current_version: CURRENT_APP_VERSION.into(),
                    remote_version: None,
                    message: format!("无法连接到 Master 机器 ({}:{})，请检查网络或该机器是否在线", ip, port),
                })
            } else {
                // 自动检查失败时保持静默
                Ok(UpdateCheckResult {
                    status: "error".into(),
                    current_version: CURRENT_APP_VERSION.into(),
                    remote_version: None,
                    message: String::new(),
                })
            };
        }
    };

    if !version_info.available || version_info.version.trim().is_empty() {
        return if is_manual {
            Ok(UpdateCheckResult {
                status: "no_master".into(),
                current_version: CURRENT_APP_VERSION.into(),
                remote_version: None,
                message: format!("Master 机器 ({}) 尚未发布更新（在其‘[文档]/LAN Drop/Update’下未找到 version.cfg）", ip),
            })
        } else {
            Ok(UpdateCheckResult {
                status: "no_master".into(),
                current_version: CURRENT_APP_VERSION.into(),
                remote_version: None,
                message: String::new(),
            })
        };
    }

    let remote_ver = version_info.version.trim().to_string();

    // 2. 版本比对：若远端版本与当前本机版本一致，则无需更新
    if remote_ver == CURRENT_APP_VERSION {
        return Ok(UpdateCheckResult {
            status: "latest".into(),
            current_version: CURRENT_APP_VERSION.into(),
            remote_version: Some(remote_ver.clone()),
            message: format!("当前程序已是最新版本 (v{})", CURRENT_APP_VERSION),
        });
    }

    log::info!("发现新版本 [v{}] (本机版本: v{})，正在从 Master [{}] 下载更新包...", remote_ver, CURRENT_APP_VERSION, download_url);

    // 3. 下载更新二进制文件与定位 [用户文档]/LAN Drop/Temp/ 临时操作目录
    let current_exe = match std::env::current_exe() {
        Ok(path) => path,
        Err(e) => {
            log::error!("无法获取当前程序可执行文件路径: {}", e);
            return Err(format!("无法定位程序自身路径: {}", e));
        }
    };

    let temp_dir = dirs::document_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("LAN Drop")
        .join("Temp");
    let _ = std::fs::create_dir_all(&temp_dir);

    let pid = std::process::id();
    let download_file = temp_dir.join(format!("update_new_{}.tmp", pid));
    if download_file.exists() {
        let _ = std::fs::remove_file(&download_file);
    }

    let dl_resp = match client.get(&download_url).send().await {
        Ok(resp) if resp.status().is_success() => resp,
        Ok(resp) => {
            return Err(format!("下载更新包失败，Master 返回状态码: {}", resp.status()));
        }
        Err(e) => {
            return Err(format!("下载更新包网络异常: {}", e));
        }
    };

    let bytes = match dl_resp.bytes().await {
        Ok(b) => b,
        Err(e) => {
            return Err(format!("读取更新包数据失败: {}", e));
        }
    };

    // 校验下载内容是否有效（文件体积必须大于 500KB，避免写入错误信息页面）
    if bytes.len() < 500_000 {
        return Err(format!("下载的更新包体积异常（仅 {} 字节），可能未放置完整的可执行文件", bytes.len()));
    }

    if let Err(e) = std::fs::write(&download_file, &bytes) {
        return Err(format!("写入临时更新文件失败: {}", e));
    }

    log::info!("更新包下载成功 ({} 字节)，位于 Temp 目录: {:?}，正在执行自替换与无缝重启...", bytes.len(), download_file);

    // 4. 执行平台相关的自替换与重启机制（保持原程序名称）
    execute_self_replace_and_restart(app, &current_exe, &download_file, &temp_dir)?;

    Ok(UpdateCheckResult {
        status: "updating".into(),
        current_version: CURRENT_APP_VERSION.into(),
        remote_version: Some(remote_ver.clone()),
        message: format!("已下载新版本 (v{})，正在替换并自动重启应用...", remote_ver),
    })
}

/// 执行自替换与拉起新进程退出
fn execute_self_replace_and_restart(
    app: &AppHandle,
    current_exe: &std::path::Path,
    download_file: &std::path::Path,
    temp_dir: &std::path::Path,
) -> Result<(), String> {
    let exe_filename = current_exe
        .file_name()
        .ok_or_else(|| "无法获取当前可执行文件名".to_string())?;

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        use std::process::Command;

        // 临时操作文件：备份旧文件统一放置在 [用户文档]/LAN Drop/Temp/ 目录下
        let old_exe = temp_dir.join(format!("{}.old", exe_filename.to_string_lossy()));
        if old_exe.exists() {
            let _ = std::fs::remove_file(&old_exe);
        }

        // 1. 尝试将运行中的旧 exe 重命名/移动至 [用户文档]/LAN Drop/Temp/ 目录
        let mut used_old_path = old_exe.clone();
        if let Err(e) = std::fs::rename(current_exe, &used_old_path) {
            log::warn!("重命名旧文件到 Temp 目录失败（可能是跨卷）: {}，使用本地过渡重命名", e);
            let local_old = current_exe.with_extension("old");
            if local_old.exists() {
                let _ = std::fs::remove_file(&local_old);
            }
            std::fs::rename(current_exe, &local_old)
                .map_err(|e2| format!("重命名旧可执行文件失败: {}", e2))?;
            used_old_path = local_old;
        }

        // 2. 将 Temp 目录下的新下载二进制文件替换到 current_exe 路径，保持用户原程序名称（如 "内网工具.exe"）
        if let Err(e) = std::fs::rename(download_file, current_exe) {
            // 若跨卷 rename 失败，采用 copy + remove 覆盖
            if let Err(e2) = std::fs::copy(download_file, current_exe).and_then(|_| std::fs::remove_file(download_file)) {
                // 替换失败，紧急将旧文件还原
                let _ = std::fs::rename(&used_old_path, current_exe);
                return Err(format!("替换新版程序文件失败: {}", e2));
            }
        }

        // 3. 构造后台 PowerShell 守护脚本：等待当前 PID 退出，删除 Temp 目录里的所有 .old 备份与 .tmp 临时文件，并拉起原名称与原路径的新程序
        let pid = std::process::id();
        let current_exe_str = current_exe.to_string_lossy().to_string();
        let temp_dir_str = temp_dir.to_string_lossy().to_string();
        let used_old_str = used_old_path.to_string_lossy().to_string();

        let ps_cmd = format!(
            r#"$ErrorActionPreference = 'SilentlyContinue';
            Wait-Process -Id {} -Timeout 15;
            Start-Sleep -Milliseconds 600;
            Remove-Item -Path '{}\*.old' -Force -ErrorAction SilentlyContinue;
            Remove-Item -Path '{}\*.tmp' -Force -ErrorAction SilentlyContinue;
            Remove-Item -Path '{}' -Force -ErrorAction SilentlyContinue;
            Start-Process -FilePath '{}';
            "#,
            pid, temp_dir_str, temp_dir_str, used_old_str, current_exe_str
        );

        let _ = Command::new("powershell")
            .args(["-NoProfile", "-WindowStyle", "Hidden", "-Command", &ps_cmd])
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .spawn();

        log::info!("自替换完成，维持原有程序文件名 [{}], 正在由守护脚本清理 Temp 临时文件并拉起新版...", exe_filename.to_string_lossy());
        app.exit(0);
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        let old_exe = temp_dir.join(format!("{}.old", exe_filename.to_string_lossy()));
        if old_exe.exists() {
            let _ = std::fs::remove_file(&old_exe);
        }

        let mut used_old_path = old_exe.clone();
        if let Err(_) = std::fs::rename(current_exe, &used_old_path) {
            let local_old = current_exe.with_extension("old");
            let _ = std::fs::rename(current_exe, &local_old);
            used_old_path = local_old;
        }

        if let Err(e) = std::fs::rename(download_file, current_exe) {
            if let Err(e2) = std::fs::copy(download_file, current_exe).and_then(|_| std::fs::remove_file(download_file)) {
                let _ = std::fs::rename(&used_old_path, current_exe);
                return Err(format!("替换可执行文件失败: {}", e2));
            }
        }

        let _ = std::fs::set_permissions(current_exe, std::fs::Permissions::from_mode(0o755));

        let temp_dir_str = temp_dir.to_string_lossy().to_string();
        let used_old_str = used_old_path.to_string_lossy().to_string();
        let current_exe_str = current_exe.to_string_lossy().to_string();

        let sh_cmd = format!(
            "sleep 1; rm -f '{}/'*.old '{}/'*.tmp '{}'; exec '{}'",
            temp_dir_str, temp_dir_str, used_old_str, current_exe_str
        );
        let _ = std::process::Command::new("sh").arg("-c").arg(&sh_cmd).spawn();

        log::info!("Unix 自替换完成，维持原程序名称 [{}]，拉起新进程并退出旧应用...", exe_filename.to_string_lossy());
        app.exit(0);
    }

    Ok(())
}
