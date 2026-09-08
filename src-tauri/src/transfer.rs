// LAN Drop (内网投送) - Tokio + Reqwest 磁盘流式推送
use futures_util::StreamExt;
use std::path::Path;
use std::sync::Arc;
use std::time::Instant;
use tokio::fs::File;
use tokio_util::io::ReaderStream;

/// 发送端：将本地磁盘文件以 64KB Chunk 直接流式发往接收端 Axum 服务
/// 零内存中间缓冲堆积，跑满百兆/千兆网卡
pub async fn stream_file_to_peer<F>(
    target_ip: &str,
    target_port: u16,
    file_path: &str,
    task_id: &str,
    progress_callback: F,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>>
where
    F: Fn(u64, u64, f64) + Send + Sync + 'static,
{
    let path = Path::new(file_path);
    let file_name = path
        .file_name()
        .map(|f| f.to_string_lossy().to_string())
        .unwrap_or_else(|| "file".to_string());
    let metadata = tokio::fs::metadata(path).await?;
    let total_size = metadata.len();

    let file = File::open(path).await?;

    let progress_callback = Arc::new(progress_callback);
    let cb_clone = progress_callback.clone();

    // 构建包装 Stream，每次读取 chunk 自动计算流速并触发回调
    let mut reader_stream = ReaderStream::with_capacity(file, 64 * 1024); // 64KB 缓冲区
    let mut sent_bytes = 0u64;
    let mut last_time = Instant::now();
    let mut last_bytes = 0u64;

    let async_stream = async_stream::stream! {
        while let Some(chunk_res) = reader_stream.next().await {
            match chunk_res {
                Ok(bytes) => {
                    sent_bytes += bytes.len() as u64;
                    if last_time.elapsed().as_millis() >= 100 {
                        let speed = (sent_bytes - last_bytes) as f64 / last_time.elapsed().as_secs_f64();
                        last_bytes = sent_bytes;
                        last_time = Instant::now();
                        cb_clone(sent_bytes, total_size, speed);
                    }
                    yield Ok::<bytes::Bytes, std::io::Error>(bytes);
                }
                Err(e) => yield Err(e),
            }
        }
    };

    let body = reqwest::Body::wrap_stream(async_stream);

    let client = reqwest::Client::builder()
        .no_proxy() // 绕过操作系统系统代理/VPN，直接点对点传输
        .timeout(std::time::Duration::from_secs(3600 * 24)) // 支持大文件长时间推流
        .tcp_nodelay(true) // 禁用 Nagle 算法，降低微延迟
        .build()?;

    let target_url = format!(
        "http://{}:{}/api/transfer/stream?task_id={}&file_name={}&file_size={}&sender_id=local",
        target_ip, target_port, urlencoding::encode(task_id), urlencoding::encode(&file_name), total_size
    );

    let resp = client
        .post(&target_url)
        .header(reqwest::header::CONTENT_LENGTH, total_size)
        .body(body)
        .send()
        .await?;

    if resp.status().is_success() {
        progress_callback(total_size, total_size, 0.0);
        Ok(())
    } else {
        Err(format!("服务端响应异常状态码: {}", resp.status()).into())
    }
}
