// 局域网消息发送与流式文件投送 Tauri IPC 指令
use crate::state::AppState;
use tauri::{AppHandle, Emitter, State};
use crate::{transfer, server, discovery};


#[tauri::command]
pub async fn send_chat_message(
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
pub async fn start_file_transfer(
    app: AppHandle,
    target_ip: String,
    target_port: u16,
    file_path: String,
    task_id: String,
    offset: Option<u64>,
    dest_name: Option<String>,
    folder: Option<String>,
) -> Result<(), String> {
    let effective_port = if target_port > 0 { target_port } else { discovery::DEFAULT_PORT };
    let resume_offset = offset.unwrap_or(0);

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

        if let Err(e) = transfer::stream_file_to_peer(
            &target_ip,
            effective_port,
            &file_path,
            &task_id,
            resume_offset,
            dest_name.as_deref(),
            folder.as_deref(),
            on_progress,
        ).await {
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
pub async fn transfer_file_data(
    app: AppHandle,
    target_ip: String,
    target_port: u16,
    task_id: String,
    file_name: String,
    file_size: u64,
    data: Vec<u8>,
    offset: Option<u64>,
    folder: Option<String>,
) -> Result<(), String> {
    let effective_port = if target_port > 0 { target_port } else { discovery::DEFAULT_PORT };
    let resume_offset = offset.unwrap_or(0);
    let folder_param = folder.unwrap_or_default();

    tokio::spawn(async move {
        let client = reqwest::Client::builder()
            .no_proxy()
            .timeout(std::time::Duration::from_secs(3600 * 24))
            .tcp_nodelay(true)
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());

        let target_url = format!(
            "http://{}:{}/api/transfer/stream?task_id={}&file_name={}&file_size={}&sender_id=local&offset={}&folder={}",
            target_ip,
            effective_port,
            urlencoding::encode(&task_id),
            urlencoding::encode(&file_name),
            file_size,
            resume_offset,
            urlencoding::encode(&folder_param)
        );

        let slice_data = if (resume_offset as usize) < data.len() {
            data[resume_offset as usize..].to_vec()
        } else {
            Vec::new()
        };
        let remaining_len = slice_data.len() as u64;

        let resp = client
            .post(&target_url)
            .header(reqwest::header::CONTENT_LENGTH, remaining_len)
            .body(slice_data)
            .send()
            .await;
        match resp {
            Ok(r) if r.status().is_success() => {
                let _ = app.emit("transfer://progress", serde_json::json!({
                    "taskId": task_id,
                    "transferred": file_size,
                    "total": file_size,
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
pub async fn get_partial_file_size(file_name: String, state: State<'_, AppState>) -> Result<u64, String> {
    let download_dir = state.download_dir.read().await.clone();
    let size = server::query_partial_file_size(&download_dir, &file_name).await;
    Ok(size)
}

