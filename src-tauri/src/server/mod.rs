// Axum 异步 HTTP 接收服务端与流式投送接收
pub mod client;
pub mod handlers;

pub use client::*;
pub use handlers::*;

use axum::{
    extract::DefaultBodyLimit,
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use std::sync::Arc;
use tauri::AppHandle;

#[derive(Clone)]
pub struct ServerContext {
    pub app: AppHandle,
    pub db: Arc<crate::db::Database>,
    pub download_dir: Arc<tokio::sync::RwLock<String>>,
    pub local_device: Arc<tokio::sync::RwLock<crate::discovery::DeviceInfo>>,
    pub notified_msg_ids: Arc<tokio::sync::Mutex<std::collections::HashSet<String>>>,
}

#[derive(Deserialize)]
pub struct StreamTransferParams {
    #[serde(default)]
    pub task_id: String,
    #[serde(default)]
    pub file_name: String,
    #[serde(default)]
    pub file_size: u64,
    #[serde(default)]
    pub sender_id: String,
    #[serde(default)]
    pub offset: u64,
    #[serde(default)]
    pub folder: String,
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
    let listener = match tokio::net::TcpListener::bind(addr).await {
        Ok(listener) => listener,
        Err(error) => {
            log::error!("[监听失败] 地址={}，原因={}；本机无法接收探测与消息，请检查端口占用", addr, error);
            return;
        }
    };
    log::info!("[监听就绪] Axum 接收服务端地址={}", addr);
    if let Err(error) = axum::serve(listener, router.into_make_service_with_connect_info::<SocketAddr>()).await {
        log::error!("[监听异常] 地址={}，原因={}", addr, error);
    }
}
