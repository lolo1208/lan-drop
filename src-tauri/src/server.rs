// LAN Drop (内网投送) - Axum 异步 HTTP 接收服务端与流式投送接收
use axum::{
    body::Body,
    extract::{ConnectInfo, DefaultBodyLimit, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tokio::fs::File;
use tokio::io::{AsyncSeekExt, AsyncWriteExt, SeekFrom};

#[derive(Clone)]
struct ServerContext {
    app: AppHandle,
    db: Arc<crate::db::Database>,
    download_dir: Arc<tokio::sync::RwLock<String>>,
    local_device: Arc<tokio::sync::RwLock<crate::discovery::DeviceInfo>>,
    notified_msg_ids: Arc<tokio::sync::Mutex<std::collections::HashSet<String>>>,
}

#[derive(Deserialize)]
struct StreamTransferParams {
    #[serde(default)]
    task_id: String,
    #[serde(default)]
    file_name: String,
    #[serde(default)]
    file_size: u64,
    #[serde(default)]
    sender_id: String,
    #[serde(default)]
    offset: u64,
    #[serde(default)]
    folder: String,
}

#[derive(Serialize, Deserialize)]
pub struct ChatMessagePayload {
    pub id: String,
    pub sender_id: String,
    pub sender_name: String,
    pub text: String,
    pub timestamp: i64,
}

/// 启动 Axum 轻量级异步服务
pub async fn start_axum_server(
    app: AppHandle,
    db: Arc<crate::db::Database>,
    port: u16,
    download_dir: Arc<tokio::sync::RwLock<String>>,
    local_device: Arc<tokio::sync::RwLock<crate::discovery::DeviceInfo>>,
) {
    let ctx = ServerContext {
        app,
        db,
        download_dir,
        local_device,
        notified_msg_ids: Arc::new(tokio::sync::Mutex::new(std::collections::HashSet::new())),
    };

    let router = Router::new()
        .route("/api/ping", get(|| async { "pong" }))
        .route("/api/info", get(handle_get_info))
        .route("/api/message", post(handle_incoming_message))
        .route("/api/transfer/stream", post(handle_stream_transfer))
        .route("/api/wake_from_tray", post(handle_wake_from_tray).get(handle_wake_from_tray))
        .route("/api/update/version", get(handle_get_update_version))
        .route("/api/update/download", get(handle_download_update))
        .layer(DefaultBodyLimit::disable())
        .layer(tower_http::cors::CorsLayer::permissive())
        .with_state(Arc::new(ctx));

    let addr = std::net::SocketAddr::from(([0, 0, 0, 0], port));
    log::info!("Axum 接收服务端已在 {} 启动", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.expect("绑定 Axum 端口失败");
    axum::serve(listener, router.into_make_service_with_connect_info::<SocketAddr>()).await.expect("Axum 服务运行异常");
}

/// 响应通知点击或外部唤醒：将应用从托盘还原并唤醒至前台
async fn handle_wake_from_tray(State(ctx): State<Arc<ServerContext>>) -> impl IntoResponse {
    if let Some(window) = ctx.app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_skip_taskbar(false);
        let _ = window.set_always_on_top(true);
        let _ = window.set_focus();
        let _ = window.set_always_on_top(false);
        let _ = window.emit("app://restored_from_tray", ());
    }
    (
        [(axum::http::header::CONTENT_TYPE, "text/html; charset=utf-8")],
        "<!DOCTYPE html><html><head><title>LAN Drop</title><script>window.onload=function(){window.close();};</script></head><body style='background:#1e1e1e;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;'><p>已恢复 LAN Drop 窗口...</p></body></html>",
    )
}

/// 响应对端探测请求：返回自身设备信息 (包含 id, name, ip, port, os, avatarUrl)
async fn handle_get_info(State(ctx): State<Arc<ServerContext>>) -> impl IntoResponse {
    let dev = ctx.local_device.read().await.clone();
    Json(dev)
}

/// 响应内网 Master 更新检查请求：读取 "[用户文档]/LAN Drop/Update/version.cfg" 版本号
async fn handle_get_update_version() -> impl IntoResponse {
    let update_dir = dirs::document_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("LAN Drop")
        .join("Update");
    let cfg_path = update_dir.join("version.cfg");

    if cfg_path.exists() && cfg_path.is_file() {
        if let Ok(content) = std::fs::read_to_string(&cfg_path) {
            let version = content.trim().to_string();
            if !version.is_empty() {
                return Json(serde_json::json!({
                    "available": true,
                    "version": version
                }));
            }
        }
    }

    Json(serde_json::json!({
        "available": false,
        "version": ""
    }))
}

/// 响应内网 Master 更新下载请求：流式提供 "[用户文档]/LAN Drop/Update/lan-drop.exe" (或 lan-drop) 文件
async fn handle_download_update() -> Result<impl IntoResponse, (axum::http::StatusCode, &'static str)> {
    let update_dir = dirs::document_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("LAN Drop")
        .join("Update");

    let exe_path = update_dir.join("lan-drop.exe");
    let unix_path = update_dir.join("lan-drop");

    let target_bin = if exe_path.exists() && exe_path.is_file() {
        Some(exe_path)
    } else if unix_path.exists() && unix_path.is_file() {
        Some(unix_path)
    } else if update_dir.exists() && update_dir.is_dir() {
        let mut found = None;
        if let Ok(entries) = std::fs::read_dir(&update_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() {
                    let fname = path.file_name().unwrap_or_default().to_string_lossy().to_lowercase();
                    if !fname.ends_with(".cfg") && !fname.ends_with(".tmp") && !fname.ends_with(".old") {
                        found = Some(path);
                        break;
                    }
                }
            }
        }
        found
    } else {
        None
    };

    let target_bin = match target_bin {
        Some(p) => p,
        None => return Err((axum::http::StatusCode::NOT_FOUND, "Master 机器尚未在该目录下放置安装更新包")),
    };

    let file_name = target_bin.file_name().unwrap_or_default().to_string_lossy().to_string();
    let file = tokio::fs::File::open(&target_bin)
        .await
        .map_err(|_| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, "读取更新包文件失败"))?;

    let file_meta = file.metadata().await.ok();
    let content_length = file_meta.map(|m| m.len());

    let stream = tokio_util::io::ReaderStream::new(file);
    let body = axum::body::Body::from_stream(stream);

    let mut headers = axum::http::HeaderMap::new();
    headers.insert(
        axum::http::header::CONTENT_TYPE,
        axum::http::HeaderValue::from_static("application/octet-stream"),
    );
    headers.insert(
        axum::http::header::CONTENT_DISPOSITION,
        axum::http::HeaderValue::from_str(&format!("attachment; filename=\"{}\"", file_name))
            .unwrap_or_else(|_| axum::http::HeaderValue::from_static("attachment; filename=\"lan-drop.exe\"")),
    );
    if let Some(len) = content_length {
        if let Ok(header_val) = axum::http::HeaderValue::from_str(&len.to_string()) {
            headers.insert(axum::http::header::CONTENT_LENGTH, header_val);
        }
    }

    Ok((headers, body))
}

/// 接收局域网即时聊天消息与信令
async fn handle_incoming_message(
    State(ctx): State<Arc<ServerContext>>,
    connect_info: Option<ConnectInfo<SocketAddr>>,
    Json(mut payload): Json<serde_json::Value>,
) -> impl IntoResponse {
    let client_ip = connect_info
        .map(|ci| ci.ip().to_string())
        .unwrap_or_default();
    log::info!("收到来自 [{}] 的局域网即时消息/信令: {:?}", client_ip, payload);

    // 确保 senderIp 字段被真实连接 IP 兜底填充
    let current_sender_ip = payload
        .get("senderIp")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    
    let effective_sender_ip = if (current_sender_ip.is_empty() || current_sender_ip == "127.0.0.1" || current_sender_ip == "0.0.0.0") && !client_ip.is_empty() {
        payload["senderIp"] = serde_json::json!(&client_ip);
        client_ip.clone()
    } else {
        current_sender_ip.to_string()
    };

    if let Some(file_att) = payload.get_mut("fileAttachment") {
        let f_ip = file_att.get("senderIp").and_then(|v| v.as_str()).unwrap_or("");
        if (f_ip.is_empty() || f_ip == "127.0.0.1" || f_ip == "0.0.0.0") && !effective_sender_ip.is_empty() {
            file_att["senderIp"] = serde_json::json!(&effective_sender_ip);
        }
    }

    // 1. 持久化存储到 SQLite 数据库
    if let Ok(json_str) = serde_json::to_string(&payload) {
        let _ = ctx.db.save_chat_message(&json_str);
    }

    // 2. 自动提取发送方元数据并注册发现对端
    if let Some(sender_id) = payload.get("senderId").and_then(|v| v.as_str()) {
        let sender_name = payload
            .get("senderName")
            .and_then(|v| v.as_str())
            .unwrap_or("局域网设备");
        let sender_port = payload
            .get("senderPort")
            .or_else(|| payload.get("fileAttachment").and_then(|f| f.get("senderPort")))
            .and_then(|v| v.as_u64())
            .unwrap_or(57088) as u16;
        let sender_avatar = payload
            .get("senderAvatarUrl")
            .and_then(|v| v.as_str())
            .unwrap_or("");

        let my_id = { ctx.local_device.read().await.id.clone() };
        if sender_id != my_id && !effective_sender_ip.is_empty() {
            let peer = crate::discovery::DeviceInfo {
                id: sender_id.to_string(),
                name: sender_name.to_string(),
                ip: effective_sender_ip.clone(),
                port: sender_port,
                os: "windows".into(),
                avatar_url: sender_avatar.to_string(),
            };
            let _ = ctx.app.emit(
                "peer://discovered",
                serde_json::json!({
                    "peer": peer,
                    "remoteIp": effective_sender_ip,
                    "timestamp": chrono::Utc::now().timestamp_millis()
                }),
            );
        }
    }

    // 3. 通知前端收到消息
    let _ = ctx.app.emit("chat://received", &payload);

    // 4. 当窗口被关闭隐藏至托盘、最小化或处于非激活状态时，Rust 底层直接触发原生系统通知（严格去重，仅提醒一次最新实时消息）
    let is_window_active = if let Some(window) = ctx.app.get_webview_window("main") {
        let is_vis = window.is_visible().unwrap_or(false);
        let is_min = window.is_minimized().unwrap_or(false);
        let is_foc = window.is_focused().unwrap_or(false);
        is_vis && !is_min && is_foc
    } else {
        false
    };

    let my_id = { ctx.local_device.read().await.id.clone() };
    let msg_id = payload.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let sender_id = payload.get("senderId").and_then(|v| v.as_str()).unwrap_or("");
    let msg_type = payload.get("msgType").and_then(|v| v.as_str()).unwrap_or("");
    let content = payload.get("content").and_then(|v| v.as_str()).unwrap_or("");
    let msg_time = payload.get("timestamp").and_then(|v| v.as_i64()).unwrap_or(0);
    let now_ms = chrono::Utc::now().timestamp_millis();
    let is_fresh = msg_time == 0 || (now_ms - msg_time).abs() < 45_000;

    let should_notify = {
        let mut cache = ctx.notified_msg_ids.lock().await;
        if !msg_id.is_empty() && cache.contains(&msg_id) {
            false
        } else {
            if !msg_id.is_empty() {
                if cache.len() > 300 {
                    cache.clear();
                }
                cache.insert(msg_id);
            }
            true
        }
    };

    if !is_window_active
        && is_fresh
        && should_notify
        && sender_id != my_id
        && msg_type != "system"
        && !content.starts_with("file_accept:")
        && !content.starts_with("file_resume:")
    {
        let sender_name = payload
            .get("senderName")
            .and_then(|v| v.as_str())
            .unwrap_or("局域网设备");

        let body_preview = if let Some(file_att) = payload.get("fileAttachment") {
            let f_name = file_att.get("name").and_then(|v| v.as_str()).unwrap_or("未知文件");
            let is_media = file_att.get("isMedia").and_then(|v| v.as_bool()).unwrap_or(false);
            if is_media || msg_type == "image" {
                format!("[图片] {}", f_name)
            } else if msg_type == "video" {
                format!("[视频] {}", f_name)
            } else if msg_type == "audio" {
                format!("[语音/音频] {}", f_name)
            } else {
                format!("[文件] {}", f_name)
            }
        } else if !content.trim().is_empty() {
            content.to_string()
        } else {
            "发来一条新消息".to_string()
        };

        crate::send_desktop_notification(
            &ctx.app,
            &format!("{} 发来新消息", sender_name),
            &body_preview,
        );
    }

    (StatusCode::OK, Json(serde_json::json!({ "status": "ok" })))
}

/// 核心：通过 Tokio AsyncWrite 流式将 HTTP Body 直接落地磁盘
/// 不在 RAM 中构建完整缓冲，极低内存占用，跑满局域网物理带宽
async fn handle_stream_transfer(
    State(ctx): State<Arc<ServerContext>>,
    Query(params): Query<StreamTransferParams>,
    body: Body,
) -> Result<StatusCode, (StatusCode, String)> {
    let mut body_stream = body.into_data_stream();
    // 针对中文及特殊字符文件名做安全清洗与解码
    let raw_file_name = urlencoding::decode(&params.file_name)
        .map(|s| s.into_owned())
        .unwrap_or_else(|_| params.file_name.clone());

    // 关键：剥离文件名中可能附带的子路径前缀 (例如 / 或 \)，防止指向不存在的子目录触发 os error 3
    let file_name_only = std::path::Path::new(&raw_file_name)
        .file_name()
        .map(|f| f.to_string_lossy().to_string())
        .unwrap_or_else(|| "downloaded_file".to_string());

    // 过滤操作系统非法路径字符
    let safe_file_name: String = file_name_only
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            _ => c,
        })
        .collect();

    // 针对媒体文件 (Media) 与普通文件 (Files) 进行目录区分
    let is_media = params.folder.eq_ignore_ascii_case("media");
    let sub_folder = if is_media { "Media" } else { "Files" };

    // 建立多重备选存储路径列表 (应对权限拒绝 os error 5 或系统限制)
    let mut candidate_dirs = Vec::new();
    if is_media {
        if let Some(doc) = dirs::document_dir() {
            candidate_dirs.push(doc.join("LAN Drop").join("Media"));
        }
    } else {
        let preferred_str = { ctx.download_dir.read().await.clone() };
        if !preferred_str.trim().is_empty() {
            candidate_dirs.push(std::path::PathBuf::from(preferred_str));
        }
    }
    if let Some(doc) = dirs::document_dir() {
        candidate_dirs.push(doc.join("LAN Drop").join(sub_folder));
    }
    if let Some(dl) = dirs::download_dir() {
        candidate_dirs.push(dl.join("LAN Drop").join(sub_folder));
    }
    if let Some(data) = dirs::data_local_dir() {
        candidate_dirs.push(data.join("LAN Drop").join(sub_folder));
    }
    candidate_dirs.push(std::env::temp_dir().join("LAN Drop").join(sub_folder));
    candidate_dirs.push(std::path::PathBuf::from(".").join("LAN Drop").join(sub_folder));

    // 若为 MD5 命名的媒体文件且本地已完整存在，直接复用已有文件，避免重复写入
    if is_media && params.file_size > 0 {
        for dir in &candidate_dirs {
            let existing_dest = dir.join(&safe_file_name);
            if existing_dest.exists() {
                if let Ok(meta) = std::fs::metadata(&existing_dest) {
                    if meta.len() == params.file_size {
                        log::info!("媒体文件已存在于本地且大小一致，跳过重复写入: {:?}", existing_dest);
                        let _ = ctx.app.emit("transfer://incoming_complete", serde_json::json!({
                            "taskId": params.task_id,
                            "fileName": safe_file_name,
                            "savedPath": existing_dest.to_string_lossy(),
                            "totalSize": meta.len(),
                        }));
                        return Ok(StatusCode::OK);
                    }
                }
            }
        }
    }

    let mut created_file: Option<(File, std::path::PathBuf)> = None;
    let mut last_err = String::new();

    for dir in candidate_dirs {
        let file_dest = dir.join(&safe_file_name);
        if let Some(parent) = file_dest.parent() {
            if let Err(e) = tokio::fs::create_dir_all(parent).await {
                last_err = format!("创建目录失败 ({:?}): {}", parent, e);
                continue;
            }
        }

        let open_res = if params.offset > 0 {
            tokio::fs::OpenOptions::new()
                .create(true)
                .write(true)
                .open(&file_dest)
                .await
        } else {
            File::create(&file_dest).await
        };

        match open_res {
            Ok(mut f) => {
                if params.offset > 0 {
                    let _ = f.seek(SeekFrom::Start(params.offset)).await;
                }
                created_file = Some((f, file_dest));
                break;
            }
            Err(e) => {
                last_err = format!("创建/打开文件失败 ({:?}): {}", file_dest, e);
            }
        }
    }

    let (mut file, file_dest) = match created_file {
        Some(pair) => pair,
        None => return Err((StatusCode::INTERNAL_SERVER_ERROR, format!("尝试所有可用存储路径均失败: {}", last_err))),
    };

    let mut received_bytes: u64 = params.offset;
    let mut last_emit_time = tokio::time::Instant::now();
    let mut last_bytes = params.offset;
    let mut is_first_chunk = true;

    while let Some(chunk_result) = body_stream.next().await {
        let chunk = match chunk_result {
            Ok(c) => c,
            Err(e) => {
                let err_msg = format!("数据流读取中断: {}", e);
                let _ = ctx.app.emit("transfer://incoming_error", serde_json::json!({
                    "taskId": params.task_id,
                    "fileName": safe_file_name,
                    "transferred": received_bytes,
                    "total": params.file_size,
                    "error": err_msg,
                }));
                return Err((StatusCode::BAD_REQUEST, err_msg));
            }
        };

        if let Err(e) = file.write_all(&chunk).await {
            let err_msg = format!("写入磁盘失败: {}", e);
            let _ = ctx.app.emit("transfer://incoming_error", serde_json::json!({
                "taskId": params.task_id,
                "fileName": safe_file_name,
                "transferred": received_bytes,
                "total": params.file_size,
                "error": err_msg,
            }));
            return Err((StatusCode::INTERNAL_SERVER_ERROR, err_msg));
        }

        received_bytes += chunk.len() as u64;

        // 首次收到 chunk 或每 60ms 计算一次当前速率并向前端推送一次 IPC 进度事件
        if is_first_chunk || last_emit_time.elapsed().as_millis() >= 60 {
            is_first_chunk = false;
            let elapsed_sec = last_emit_time.elapsed().as_secs_f64();
            let speed = if elapsed_sec > 0.0 {
                (received_bytes - last_bytes) as f64 / elapsed_sec
            } else {
                0.0
            };
            last_bytes = received_bytes;
            last_emit_time = tokio::time::Instant::now();

            let _ = ctx.app.emit("transfer://incoming_progress", serde_json::json!({
                "taskId": params.task_id,
                "fileName": safe_file_name,
                "transferred": received_bytes,
                "total": params.file_size,
                "speed": speed,
            }));
        }
    }

    file.flush().await.ok();

    // 通知前端接收完成
    let _ = ctx.app.emit("transfer://incoming_complete", serde_json::json!({
        "taskId": params.task_id,
        "fileName": safe_file_name,
        "savedPath": file_dest.to_string_lossy(),
        "totalSize": received_bytes,
    }));

    Ok(StatusCode::OK)
}

/// 检查目标文件在本地已落盘的大小（用于断点续传精准确定 offset）
pub async fn query_partial_file_size(download_dir: &str, file_name: &str) -> u64 {
    let file_name_only = std::path::Path::new(file_name)
        .file_name()
        .map(|f| f.to_string_lossy().to_string())
        .unwrap_or_else(|| file_name.to_string());

    let safe_name: String = file_name_only
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            _ => c,
        })
        .collect();

    let mut candidate_dirs = Vec::new();
    if !download_dir.trim().is_empty() {
        candidate_dirs.push(std::path::PathBuf::from(download_dir));
    }
    if let Some(doc) = dirs::document_dir() {
        candidate_dirs.push(doc.join("LAN Drop").join("Files"));
    }
    if let Some(dl) = dirs::download_dir() {
        candidate_dirs.push(dl.join("LAN Drop").join("Files"));
    }
    if let Some(data) = dirs::data_local_dir() {
        candidate_dirs.push(data.join("LAN Drop").join("Files"));
    }
    candidate_dirs.push(std::env::temp_dir().join("LAN Drop").join("Files"));
    candidate_dirs.push(std::path::PathBuf::from(".").join("LAN Drop").join("Files"));

    for dir in candidate_dirs {
        let p = dir.join(&safe_name);
        if let Ok(meta) = tokio::fs::metadata(&p).await {
            if meta.is_file() {
                return meta.len();
            }
        }
    }
    0
}

/// 发送 HTTP 消息给对端
pub async fn send_http_message(
    ip: &str,
    port: u16,
    payload: serde_json::Value,
) -> Result<(), String> {
    let clean_ip = ip.trim();
    if clean_ip.is_empty() {
        return Err("目标 IP 地址为空".into());
    }

    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(6))
        .connect_timeout(Duration::from_secs(3))
        .tcp_nodelay(true)
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    let url = format!("http://{}:{}/api/message", clean_ip, port);
    log::info!("正在向对端发送 HTTP 消息: {}", url);
    let resp = client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("无法连接对端 ({}): {}", url, e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        log::error!("对端返回错误响应 {}: {}", status, body);
        return Err(format!("对端响应状态码 {}: {}", status, body));
    }

    log::info!("对端 {} 响应 HTTP 状态码: {}", url, resp.status());
    Ok(())
}
