// 局域网断点续传已接收尺寸探测客户端
use std::time::Duration;

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
