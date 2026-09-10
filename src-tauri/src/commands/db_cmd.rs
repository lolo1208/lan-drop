// 数据库与设置读写 Tauri IPC 指令
use crate::state::AppState;
use tauri::State;
use crate::AppSettingsPayload;
use crate::configure_autostart;

#[tauri::command]
pub async fn db_get_all_settings(state: State<'_, AppState>) -> Result<AppSettingsPayload, String> {
    let dev = state.local_device.read().await;
    let download_dir = state.download_dir.read().await;
    let kv_map = state.db.get_all_kv().unwrap_or_default();

    let id = kv_map.get("node_id").cloned().unwrap_or_else(|| dev.id.clone());
    let name = kv_map.get("user_name").cloned().filter(|s| !s.trim().is_empty()).unwrap_or_else(|| dev.name.clone());
    let avatar_url = kv_map.get("avatar_url").cloned().unwrap_or_else(|| dev.avatar_url.clone());
    let port = kv_map
        .get("port")
        .and_then(|p| p.parse::<u16>().ok())
        .filter(|&p| p >= 1024)
        .unwrap_or(dev.port);
    let auto_start = kv_map
        .get("auto_start")
        .map(|s| s == "true")
        .unwrap_or(false);
    let global_hotkey = kv_map
        .get("global_hotkey")
        .cloned()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "Ctrl+Alt+Shift+S".to_string());
    let update_url = kv_map.get("update_url").cloned().unwrap_or_default();
    let real_doc_files_dir = dirs::document_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("LAN Drop")
        .join("Files")
        .to_string_lossy()
        .to_string();

    let mut saved_dir = kv_map
        .get("download_dir")
        .cloned()
        .filter(|d| !d.trim().is_empty())
        .unwrap_or_else(|| download_dir.clone());

    if saved_dir.contains("\\Users\\User\\") 
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
        update_url,
        auto_start,
        global_hotkey,
    })
}

#[tauri::command]
pub async fn db_save_all_settings(settings: AppSettingsPayload, state: State<'_, AppState>) -> Result<(), String> {
    let _ = state.db.set_kv("user_name", &settings.name);
    let _ = state.db.set_kv("avatar_url", &settings.avatar_url);
    let _ = state.db.set_kv("port", &settings.port.to_string());
    let _ = state.db.set_kv("download_dir", &settings.download_dir);
    let _ = state.db.set_kv("auto_start", &settings.auto_start.to_string());
    let _ = state.db.set_kv("update_url", &settings.update_url);
    let _ = state.db.set_kv("global_hotkey", &settings.global_hotkey);

    let _ = configure_autostart(settings.auto_start);

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
pub fn db_get_kv(key: String, state: State<'_, AppState>) -> Result<Option<String>, String> {
    state.db.get_kv(&key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_set_kv(key: String, value: String, state: State<'_, AppState>) -> Result<(), String> {
    state.db.set_kv(&key, &value).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_save_chat_message(msg_json: String, state: State<'_, AppState>) -> Result<(), String> {
    state.db.save_chat_message(&msg_json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_get_all_chat_messages(state: State<'_, AppState>) -> Result<Vec<serde_json::Value>, String> {
    state.db.get_all_chat_messages().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_get_chat_messages_by_peer(peer_id: String, state: State<'_, AppState>) -> Result<Vec<serde_json::Value>, String> {
    state.db.get_chat_messages_by_peer(&peer_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_save_transfer(transfer_json: String, state: State<'_, AppState>) -> Result<(), String> {
    state.db.save_transfer(&transfer_json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_get_all_transfers(state: State<'_, AppState>) -> Result<Vec<serde_json::Value>, String> {
    state.db.get_all_transfers().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_delete_chat_message(msg_id: String, state: State<'_, AppState>) -> Result<(), String> {
    state.db.delete_chat_message(&msg_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_delete_chat_messages(msg_ids: Vec<String>, state: State<'_, AppState>) -> Result<(), String> {
    state.db.delete_chat_messages_by_ids(&msg_ids).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_clear_chat_by_peer(peer_id: String, state: State<'_, AppState>) -> Result<(), String> {
    state.db.clear_chat_by_peer(&peer_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_delete_transfer(task_id: String, state: State<'_, AppState>) -> Result<(), String> {
    state.db.delete_transfer_by_id(&task_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_clear_all_history(state: State<'_, AppState>) -> Result<(), String> {
    state.db.clear_all_history().map_err(|e| e.to_string())
}

