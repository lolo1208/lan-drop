// LAN Drop (内网投送) - Axum 异步 HTTP 接收服务端
use axum::{
    body::Body,
    extract::{Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::fs::File;
use tokio::io::AsyncWriteExt;

#[derive(Clone)]
struct ServerContext {
    app: AppHandle,
    download_dir: Arc<tokio::sync::RwLock<String>>,
}

#[derive(Deserialize)]
struct StreamTransferParams {
    task_id: String,
    file_name: String,
    file_size: u64,
    sender_id: String,
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
pub async fn start_axum_server(app: AppHandle, port: u16, download_dir: Arc<tokio::sync::RwLock<String>>) {
    let ctx = ServerContext {
        app,
        download_dir,
    };

    let router = Router::new()
        .route("/api/ping", get(|| async { "pong" }))
        .route("/api/message", post(handle_incoming_message))
        .route("/api/transfer/stream", post(handle_stream_transfer))
        .layer(tower_http::cors::CorsLayer::permissive())
        .with_state(Arc::new(ctx));

    let addr = std::net::SocketAddr::from(([0, 0, 0, 0], port));
    log::info!("Axum 接收服务端已在 {} 启动", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.expect("绑定 Axum 端口失败");
    axum::serve(listener, router).await.expect("Axum 服务运行异常");
}

/// 接收局域网即时聊天消息
async fn handle_incoming_message(
    State(ctx): State<Arc<ServerContext>>,
    Json(payload): Json<serde_json::Value>,
) -> impl IntoResponse {
    let _ = ctx.app.emit("chat://received", &payload);
    StatusCode::OK
}

/// 核心：通过 Tokio AsyncWrite 流式将 HTTP Body 直接落地磁盘
/// 不在 RAM 中构建完整缓冲，极低内存占用！
async fn handle_stream_transfer(
    State(ctx): State<Arc<ServerContext>>,
    Query(params): Query<StreamTransferParams>,
    body: Body,
) -> Result<StatusCode, (StatusCode, String)> {
    let mut body_stream = body.into_data_stream();
    let download_dir = {
        let dir_lock = ctx.download_dir.read().await;
        std::path::PathBuf::from(dir_lock.clone())
    };
    tokio::fs::create_dir_all(&download_dir).await.ok();
    
    let file_dest = download_dir.join(&params.file_name);
    let mut file = File::create(&file_dest)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("创建文件失败: {}", e)))?;

    let mut received_bytes: u64 = 0;
    let mut last_emit_time = tokio::time::Instant::now();
    let mut last_bytes = 0u64;

    while let Some(chunk_result) = body_stream.next().await {
        let chunk = chunk_result.map_err(|e| (StatusCode::BAD_REQUEST, format!("数据流读取中断: {}", e)))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("写入磁盘失败: {}", e)))?;

        received_bytes += chunk.len() as u64;

        // 每 100ms 计算一次当前速率并向前端推送一次 IPC 进度事件
        if last_emit_time.elapsed().as_millis() >= 100 {
            let elapsed_sec = last_emit_time.elapsed().as_secs_f64();
            let speed = (received_bytes - last_bytes) as f64 / elapsed_sec;
            last_bytes = received_bytes;
            last_emit_time = tokio::time::Instant::now();

            let _ = ctx.app.emit("transfer://incoming_progress", serde_json::json!({
                "taskId": params.task_id,
                "fileName": params.file_name,
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
        "fileName": params.file_name,
        "savedPath": file_dest.to_string_lossy(),
        "totalSize": received_bytes,
    }));

    Ok(StatusCode::OK)
}

/// 发送 HTTP 消息给对端
pub async fn send_http_message(
    ip: &str,
    port: u16,
    payload: serde_json::Value,
) -> Result<(), reqwest::Error> {
    let client = reqwest::Client::new();
    let url = format!("http://{}:{}/api/message", ip, port);
    client.post(&url).json(&payload).send().await?;
    Ok(())
}
