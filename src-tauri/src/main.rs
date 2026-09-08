// LAN Drop (内网投送) - Tauri v2 主程序入口
// ⚠️ 架构约束规范（CRITICAL）：
// 严禁在此项目中使用或添加任何 UDP 组播/广播逻辑！
// 局域网设备探测全部基于 HTTP 并发探测（GET /api/info），通信全部基于 HTTP/TCP（默认端口 57088）。
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

#[tauri::command]
async fn sync_local_device(
    device: discovery::DeviceInfo,
    state: State<'_, AppState>,
) -> Result<discovery::DeviceInfo, String> {
    let mut dev = state.local_device.write().await;
    let real_ip = dev.ip.clone();
    let persistent_id = dev.id.clone();
    *dev = device;
    if !persistent_id.is_empty() {
        dev.id = persistent_id;
    }
    if !real_ip.is_empty() && real_ip != "127.0.0.1" && real_ip != "0.0.0.0" {
        dev.ip = real_ip;
    }
    if dev.port == 0 {
        dev.port = discovery::DEFAULT_PORT;
    }
    log::info!("本机配置已同步: ID={}, Name={}, IP={}, Port={}, Avatar={}", dev.id, dev.name, dev.ip, dev.port, dev.avatar_url);
    Ok(dev.clone())
}

#[tauri::command]
async fn update_local_device(name: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut dev = state.local_device.write().await;
    dev.name = name;
    Ok(())
}

#[tauri::command]
async fn trigger_discovery_scan(app: AppHandle, state: State<'_, AppState>) -> Result<Vec<discovery::DeviceInfo>, String> {
    let devices = discovery::scan_subnet_peers(&app, &state.local_device).await;
    Ok(devices)
}

#[tauri::command]
async fn probe_peer_ip(
    app: AppHandle,
    ip: String,
    port: Option<u16>,
    state: State<'_, AppState>,
) -> Result<discovery::DeviceInfo, String> {
    let local_port = { state.local_device.read().await.port };
    let default_fallback_port = if local_port > 0 { local_port } else { discovery::DEFAULT_PORT };
    let target_port = port.unwrap_or(default_fallback_port);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(2500))
        .connect_timeout(std::time::Duration::from_millis(1500))
        .build()
        .map_err(|e| e.to_string())?;

    // 优先探测目标端口
    let mut peer_opt = discovery::probe_single_peer(&client, &ip, target_port).await;
    
    // 若失败且目标端口不是 57088，尝试 57088
    if peer_opt.is_none() && target_port != discovery::DEFAULT_PORT {
        peer_opt = discovery::probe_single_peer(&client, &ip, discovery::DEFAULT_PORT).await;
    }
    // 若仍失败且目标端口不是 7890，尝试 7890
    if peer_opt.is_none() && target_port != 7890 {
        peer_opt = discovery::probe_single_peer(&client, &ip, 7890).await;
    }

    if let Some(peer) = peer_opt {
        let my_id = { state.local_device.read().await.id.clone() };
        if peer.id == my_id {
            return Err("无法添加本机自身".into());
        }

        let _ = app.emit(
            "peer://discovered",
            serde_json::json!({
                "peer": peer,
                "remoteIp": peer.ip,
                "timestamp": chrono::Utc::now().timestamp_millis()
            }),
        );
        Ok(peer)
    } else {
        Err(format!("无法连接到 {}:{}，请检查对端 IP、端口与防火墙设置", ip, target_port))
    }
}

#[derive(serde::Serialize)]
struct SysInfo {
    node_id: String,
    hostname: String,
    document_dir: String,
    local_ip: String,
    port: u16,
    db_path: String,
}

#[tauri::command]
async fn get_sys_info(state: State<'_, AppState>) -> Result<SysInfo, String> {
    let hostname = whoami::fallible::hostname().unwrap_or_else(|_| "Desktop".into());
    let lan_drop_dir = dirs::document_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("LAN Drop");
    let doc_dir = lan_drop_dir
        .join("Files")
        .to_string_lossy()
        .to_string();
    let db_path = lan_drop_dir
        .join("data.db")
        .to_string_lossy()
        .to_string();
    let dev = state.local_device.read().await;
    Ok(SysInfo {
        node_id: dev.id.clone(),
        hostname,
        document_dir: doc_dir,
        local_ip: dev.ip.clone(),
        port: dev.port,
        db_path,
    })
}

#[tauri::command]
async fn send_chat_message(
    target_ip: String,
    target_port: u16,
    message: serde_json::Value,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let effective_port = if target_port > 0 { target_port } else { discovery::DEFAULT_PORT };
    
    // 自动在数据库中记录发出的消息
    if let Ok(json_str) = serde_json::to_string(&message) {
        let _ = state.db.save_chat_message(&json_str);
    }

    server::send_http_message(&target_ip, effective_port, message)
        .await
        .map_err(|e| format!("发送失败: {}", e))
}

#[tauri::command]
async fn start_file_transfer(
    app: AppHandle,
    target_ip: String,
    target_port: u16,
    file_path: String,
    task_id: String,
) -> Result<(), String> {
    let effective_port = if target_port > 0 { target_port } else { discovery::DEFAULT_PORT };

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

        if let Err(e) = transfer::stream_file_to_peer(&target_ip, effective_port, &file_path, &task_id, on_progress).await {
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
async fn transfer_file_data(
    app: AppHandle,
    target_ip: String,
    target_port: u16,
    task_id: String,
    file_name: String,
    file_size: u64,
    data: Vec<u8>,
) -> Result<(), String> {
    let effective_port = if target_port > 0 { target_port } else { discovery::DEFAULT_PORT };

    tokio::spawn(async move {
        let client = reqwest::Client::builder()
            .no_proxy()
            .timeout(std::time::Duration::from_secs(3600 * 24))
            .tcp_nodelay(true)
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());

        let target_url = format!(
            "http://{}:{}/api/transfer/stream?task_id={}&file_name={}&file_size={}&sender_id=local",
            target_ip,
            effective_port,
            urlencoding::encode(&task_id),
            urlencoding::encode(&file_name),
            file_size
        );

        let total_size = data.len() as u64;
        let resp = client
            .post(&target_url)
            .header(reqwest::header::CONTENT_LENGTH, total_size)
            .body(data)
            .send()
            .await;
        match resp {
            Ok(r) if r.status().is_success() => {
                let _ = app.emit("transfer://progress", serde_json::json!({
                    "taskId": task_id,
                    "transferred": total_size,
                    "total": total_size,
                    "speed": 0.0,
                }));
            }
            Ok(r) => {
                let status = r.status();
                let err_text = r.text().await.unwrap_or_default();
                log::error!("对端流式接口返回异常状态 {}: {}", status, err_text);
                let _ = app.emit("transfer://error", serde_json::json!({
                    "taskId": task_id,
                    "error": format!("状态异常: {} - {}", status, err_text)
                }));
            }
            Err(e) => {
                log::error!("向对端推送数据失败: {}", e);
                let _ = app.emit("transfer://error", serde_json::json!({
                    "taskId": task_id,
                    "error": e.to_string()
                }));
            }
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

// SQLite 数据库持久化 IPC 指令
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct AppSettingsPayload {
    pub id: String,
    pub name: String,
    #[serde(rename = "avatarUrl")]
    pub avatar_url: String,
    pub os: String,
    pub ip: String,
    pub port: u16,
    #[serde(rename = "multicastGroup", default = "default_multicast_group")]
    pub multicast_group: String,
    #[serde(rename = "autoAccept", default)]
    pub auto_accept: bool,
    #[serde(rename = "downloadDir")]
    pub download_dir: String,
    #[serde(rename = "heartbeatInterval", default = "default_heartbeat_interval")]
    pub heartbeat_interval: u32,
    #[serde(rename = "updateUrl", default)]
    pub update_url: String,
    #[serde(rename = "autoStart", default = "default_true")]
    pub auto_start: bool,
}

fn default_multicast_group() -> String {
    "239.255.42.99:7432".to_string()
}
fn default_heartbeat_interval() -> u32 {
    10
}
fn default_true() -> bool {
    true
}

#[tauri::command]
async fn db_get_all_settings(state: State<'_, AppState>) -> Result<AppSettingsPayload, String> {
    let dev = state.local_device.read().await;
    let download_dir = state.download_dir.read().await;
    let kv_map = state.db.get_all_kv().unwrap_or_default();

    let id = kv_map.get("node_id").cloned().unwrap_or_else(|| dev.id.clone());
    let name = kv_map.get("user_name").cloned().unwrap_or_else(|| dev.name.clone());
    let avatar_url = kv_map.get("avatar_url").cloned().unwrap_or_default();
    let port = kv_map
        .get("port")
        .and_then(|p| p.parse::<u16>().ok())
        .unwrap_or(dev.port);
    let auto_start = kv_map
        .get("auto_start")
        .map(|s| s != "false")
        .unwrap_or(true);
    let update_url = kv_map.get("update_url").cloned().unwrap_or_default();
    let real_doc_files_dir = dirs::document_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("LAN Drop")
        .join("Files")
        .to_string_lossy()
        .to_string();

    let mut saved_dir = kv_map.get("download_dir").cloned().unwrap_or_else(|| download_dir.clone());
    if saved_dir.trim().is_empty() 
        || saved_dir.contains("\\Users\\User\\") 
        || saved_dir.contains("/Users/User/") 
        || saved_dir.contains("/home/user/") 
    {
        saved_dir = real_doc_files_dir;
        let _ = state.db.set_kv("download_dir", &saved_dir);
        let mut dir_lock = state.download_dir.write().await;
        *dir_lock = saved_dir.clone();
    }

    Ok(AppSettingsPayload {
        id,
        name,
        avatar_url,
        os: dev.os.clone(),
        ip: dev.ip.clone(),
        port,
        multicast_group: "239.255.42.99:7432".into(),
        auto_accept: false,
        download_dir: saved_dir,
        heartbeat_interval: 10,
        update_url: update_url,
        auto_start: auto_start,
    })
}

#[tauri::command]
async fn db_save_all_settings(settings: AppSettingsPayload, state: State<'_, AppState>) -> Result<(), String> {
    let _ = state.db.set_kv("user_name", &settings.name);
    let _ = state.db.set_kv("avatar_url", &settings.avatar_url);
    let _ = state.db.set_kv("port", &settings.port.to_string());
    let _ = state.db.set_kv("download_dir", &settings.download_dir);
    let _ = state.db.set_kv("auto_start", &settings.auto_start.to_string());
    let _ = state.db.set_kv("update_url", &settings.update_url);

    // 同步更新内存状态
    {
        let mut dev = state.local_device.write().await;
        dev.name = settings.name;
        dev.avatar_url = settings.avatar_url;
        if settings.port > 0 {
            dev.port = settings.port;
        }
    }
    {
        let mut dir = state.download_dir.write().await;
        *dir = settings.download_dir;
    }

    Ok(())
}

#[tauri::command]
fn db_get_kv(key: String, state: State<'_, AppState>) -> Result<Option<String>, String> {
    state.db.get_kv(&key).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_set_kv(key: String, value: String, state: State<'_, AppState>) -> Result<(), String> {
    state.db.set_kv(&key, &value).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_save_chat_message(msg_json: String, state: State<'_, AppState>) -> Result<(), String> {
    state.db.save_chat_message(&msg_json).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_get_all_chat_messages(state: State<'_, AppState>) -> Result<Vec<serde_json::Value>, String> {
    state.db.get_all_chat_messages().map_err(|e| e.to_string())
}

#[tauri::command]
fn db_get_chat_messages_by_peer(peer_id: String, state: State<'_, AppState>) -> Result<Vec<serde_json::Value>, String> {
    state.db.get_chat_messages_by_peer(&peer_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_save_transfer(transfer_json: String, state: State<'_, AppState>) -> Result<(), String> {
    state.db.save_transfer(&transfer_json).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_get_all_transfers(state: State<'_, AppState>) -> Result<Vec<serde_json::Value>, String> {
    state.db.get_all_transfers().map_err(|e| e.to_string())
}

#[tauri::command]
fn db_clear_all_history(state: State<'_, AppState>) -> Result<(), String> {
    state.db.clear_all_history().map_err(|e| e.to_string())
}

/// 智能挑选最优真实局域网 IP（避开 WSL/Docker/虚拟网卡）
pub fn detect_best_local_ip() -> std::net::IpAddr {
    if let Ok(interfaces) = local_ip_address::list_afinet_netifas() {
        // 第一优先级：物理网卡上的 192.168.x.x
        for (name, ip) in &interfaces {
            let lower_name = name.to_lowercase();
            if lower_name.contains("vethernet")
                || lower_name.contains("wsl")
                || lower_name.contains("docker")
                || lower_name.contains("tailscale")
                || lower_name.contains("vmnet")
                || lower_name.contains("virtualbox")
            {
                continue;
            }

            if let std::net::IpAddr::V4(ipv4) = ip {
                let octets = ipv4.octets();
                if octets[0] == 192 && octets[1] == 168 && !ipv4.is_loopback() {
                    return std::net::IpAddr::V4(*ipv4);
                }
            }
        }

        // 第二优先级：物理网卡上的 10.x.x.x
        for (name, ip) in &interfaces {
            let lower_name = name.to_lowercase();
            if lower_name.contains("vethernet")
                || lower_name.contains("wsl")
                || lower_name.contains("docker")
                || lower_name.contains("tailscale")
            {
                continue;
            }

            if let std::net::IpAddr::V4(ipv4) = ip {
                let octets = ipv4.octets();
                if octets[0] == 10 && !ipv4.is_loopback() {
                    return std::net::IpAddr::V4(*ipv4);
                }
            }
        }

        // 第三优先级：物理网卡上的 172.16-31.x.x
        for (name, ip) in &interfaces {
            let lower_name = name.to_lowercase();
            if lower_name.contains("vethernet")
                || lower_name.contains("wsl")
                || lower_name.contains("docker")
                || lower_name.contains("tailscale")
            {
                continue;
            }

            if let std::net::IpAddr::V4(ipv4) = ip {
                let octets = ipv4.octets();
                if octets[0] == 172 && octets[1] >= 16 && octets[1] <= 31 && !ipv4.is_loopback() {
                    return std::net::IpAddr::V4(*ipv4);
                }
            }
        }

        // 第四优先级：任意非虚拟、非 loopback 的 IPv4
        for (_name, ip) in &interfaces {
            if let std::net::IpAddr::V4(ipv4) = ip {
                if !ipv4.is_loopback() && !ipv4.is_link_local() && !ipv4.is_unspecified() {
                    return std::net::IpAddr::V4(*ipv4);
                }
            }
        }
    }

    local_ip_address::local_ip().unwrap_or_else(|_| std::net::IpAddr::V4(std::net::Ipv4Addr::new(127, 0, 0, 1)))
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    // 1. 初始化 SQLite 数据库与获取持久化设备唯一标识
    // 数据库路径规范："[用户文档]/LAN Drop/data.db"
    let lan_drop_dir = dirs::document_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("LAN Drop");
    let _ = std::fs::create_dir_all(&lan_drop_dir);

    let db_path = lan_drop_dir.join("data.db");
    let old_db_path = lan_drop_dir.join("lan_drop.db");
    let old_root_db = std::path::PathBuf::from("lan_drop.db");

    // 平滑迁移旧数据库文件（若存在旧版 lan_drop.db 且 data.db 尚不存在）
    if !db_path.exists() {
        if old_db_path.exists() {
            let _ = std::fs::rename(&old_db_path, &db_path);
        } else if old_root_db.exists() {
            let _ = std::fs::rename(&old_root_db, &db_path);
        }
    }

    let database = Arc::new(db::Database::init(&db_path.to_string_lossy()).expect("无法初始化数据库 [用户文档]/LAN Drop/data.db"));
    let node_id = match database.get_kv("node_id") {
        Ok(Some(id)) if !id.is_empty() => id,
        _ => {
            let new_id = format!("node-{}", uuid::Uuid::new_v4().simple());
            let _ = database.set_kv("node_id", &new_id);
            new_id
        }
    };

    // 2. 获取本地最优网络信息与设备标识
    let local_ip = detect_best_local_ip();
    let hostname = whoami::fallible::hostname().unwrap_or_else(|_| "Desktop".into());
    let local_info = discovery::DeviceInfo {
        id: node_id,
        name: hostname,
        ip: local_ip.to_string(),
        port: discovery::DEFAULT_PORT,
        os: std::env::consts::OS.to_string(),
        avatar_url: String::new(),
    };

    let local_state = Arc::new(RwLock::new(local_info.clone()));

    let default_doc_dir_path = dirs::document_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("LAN Drop")
        .join("Files");
    let _ = std::fs::create_dir_all(&default_doc_dir_path);
    let default_doc_dir = default_doc_dir_path.to_string_lossy().to_string();
    let download_dir = Arc::new(RwLock::new(default_doc_dir));

    tauri::Builder::default()
        .manage(AppState {
            db: database.clone(),
            local_device: local_state.clone(),
            download_dir: download_dir.clone(),
        })
        .setup(move |app| {
            let handle = app.handle().clone();

            // 2. 启动纯 HTTP 网段设备并发探测守护线程 (⚠️ 禁止添加 UDP 组播/广播逻辑)
            let disc_handle = handle.clone();
            let disc_local_state = local_state.clone();
            tokio::spawn(async move {
                discovery::run_http_discovery_daemon(disc_handle, disc_local_state).await;
            });

            // 3. 启动 Axum 异步 HTTP 接收服务 (支持流式接收，不占大内存)
            let server_handle = handle.clone();
            let server_db = database.clone();
            let server_port = local_info.port;
            let server_download_dir = download_dir.clone();
            let server_local_state = local_state.clone();
            tokio::spawn(async move {
                server::start_axum_server(server_handle, server_db, server_port, server_download_dir, server_local_state).await;
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_local_device,
            sync_local_device,
            update_local_device,
            trigger_discovery_scan,
            probe_peer_ip,
            get_sys_info,
            set_download_dir,
            send_chat_message,
            start_file_transfer,
            transfer_file_data,
            open_in_folder,
            db_get_all_settings,
            db_save_all_settings,
            db_get_kv,
            db_set_kv,
            db_save_chat_message,
            db_get_all_chat_messages,
            db_get_chat_messages_by_peer,
            db_save_transfer,
            db_get_all_transfers,
            db_clear_all_history
        ])
        .run(tauri::generate_context!())
        .expect("启动 Tauri 应用失败");
}
