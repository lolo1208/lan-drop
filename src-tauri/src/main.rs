// LAN Drop (内网投送) - Tauri v2 主程序入口
// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;
mod discovery;
mod server;
mod transfer;

use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::RwLock;

// 共享应用状态
pub struct AppState {
    pub db: Arc<db::Database>,
    pub local_device: Arc<RwLock<discovery::DeviceInfo>>,
    pub download_dir: Arc<RwLock<String>>,
}

#[tauri::command]
async fn set_download_dir(dir: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut download_dir = state.download_dir.write().await;
    *download_dir = dir;
    Ok(())
}

#[tauri::command]
async fn get_local_device(state: State<'_, AppState>) -> Result<discovery::DeviceInfo, String> {
    let dev = state.local_device.read().await;
    Ok(dev.clone())
}

#[derive(serde::Serialize)]
struct SysInfo {
    hostname: String,
    document_dir: String,
}

#[tauri::command]
fn get_sys_info() -> Result<SysInfo, String> {
    let hostname = whoami::fallible::hostname().unwrap_or_else(|_| "Desktop".into());
    let doc_dir = dirs::document_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("LAN Drop")
        .to_string_lossy()
        .to_string();
    Ok(SysInfo {
        hostname,
        document_dir: doc_dir,
    })
}

#[tauri::command]
async fn send_chat_message(
    target_ip: String,
    target_port: u16,
    message: serde_json::Value,
    _state: State<'_, AppState>,
) -> Result<(), String> {
    server::send_http_message(&target_ip, target_port, message)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn start_file_transfer(
    app: AppHandle,
    target_ip: String,
    target_port: u16,
    file_path: String,
    task_id: String,
) -> Result<(), String> {
    tokio::spawn(async move {
        let app_clone = app.clone();
        let task_id_progress = task_id.clone();
        let on_progress = move |sent: u64, total: u64, speed: f64| {
            let _ = app_clone.emit("transfer://progress", serde_json::json!({
                "taskId": task_id_progress,
                "transferred": sent,
                "total": total,
                "speed": speed,
            }));
        };

        if let Err(e) = transfer::stream_file_to_peer(&target_ip, target_port, &file_path, on_progress).await {
            log::error!("传输失败: {}", e);
            let _ = app.emit("transfer://error", serde_json::json!({
                "taskId": task_id,
                "error": e.to_string()
            }));
        }
    });

    Ok(())
}

#[tauri::command]
fn open_in_folder(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let res = std::process::Command::new("explorer")
        .args(["/select,", &path])
        .spawn();

    #[cfg(target_os = "macos")]
    let res = std::process::Command::new("open")
        .args(["-R", &path])
        .spawn();

    #[cfg(target_os = "linux")]
    let res = std::process::Command::new("xdg-open")
        .arg(&path)
        .spawn();

    res.map(|_| ()).map_err(|e| e.to_string())
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    // 1. 获取本地网络信息与设备标识
    let local_ip = local_ip_address::local_ip().unwrap_or_else(|_| std::net::IpAddr::V4(std::net::Ipv4Addr::new(127, 0, 0, 1)));
    let hostname = whoami::fallible::hostname().unwrap_or_else(|_| "Desktop".into());
    let local_info = discovery::DeviceInfo {
        id: uuid::Uuid::new_v4().to_string(),
        name: format!("{} ({})", hostname, local_ip),
        ip: local_ip.to_string(),
        port: 7890,
        os: std::env::consts::OS.to_string(),
    };

    let local_state = Arc::new(RwLock::new(local_info.clone()));
    let database = Arc::new(db::Database::init("lan_drop.db").expect("无法初始化数据库"));

    let default_doc_dir = dirs::document_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("LAN Drop")
        .to_string_lossy()
        .to_string();
    let download_dir = Arc::new(RwLock::new(default_doc_dir));

    tauri::Builder::default()
        .manage(AppState {
            db: database.clone(),
            local_device: local_state.clone(),
            download_dir: download_dir.clone(),
        })
        .setup(move |app| {
            let handle = app.handle().clone();

            // 2. 启动 UDP 组播自动发现守护线程
            let disc_handle = handle.clone();
            let disc_info = local_info.clone();
            tokio::spawn(async move {
                discovery::run_multicast_daemon(disc_handle, disc_info).await;
            });

            // 3. 启动 Axum 异步 HTTP 接收服务 (支持流式接收，不占大内存)
            let server_handle = handle.clone();
            let server_port = local_info.port;
            let server_download_dir = download_dir.clone();
            tokio::spawn(async move {
                server::start_axum_server(server_handle, server_port, server_download_dir).await;
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_local_device,
            get_sys_info,
            set_download_dir,
            send_chat_message,
            start_file_transfer,
            open_in_folder
        ])
        .run(tauri::generate_context!())
        .expect("启动 Tauri 应用失败");
}
