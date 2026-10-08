// 窗口、托盘、系统通知与全局快捷键 Tauri IPC 指令
use crate::state::AppState;
use tauri::{AppHandle, Emitter, Manager, State};
use crate::updater;
use crate::{configure_autostart, toggle_main_window, send_desktop_notification};
use crate::system::hotkeys::{update_hotkeys, HotkeyState};

// 前端统一传入 PNG；解码和系统剪贴板操作在后台线程执行。
#[tauri::command]
pub async fn copy_image_to_clipboard(data: Vec<u8>) -> Result<(), String> {
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(move || {
            let image = image::load_from_memory_with_format(&data, image::ImageFormat::Png)
                .map_err(|e| format!("读取图片失败：{}", e))?
                .into_rgba8();
            let width = image.width() as usize;
            let height = image.height() as usize;
            let mut clipboard = arboard::Clipboard::new()
                .map_err(|e| format!("无法访问系统剪贴板：{}", e))?;
            clipboard.set_image(arboard::ImageData {
                width,
                height,
                bytes: std::borrow::Cow::Owned(image.into_raw()),
            }).map_err(|e| format!("复制图片失败：{}", e))
        }).await.map_err(|e| format!("复制图片任务失败：{}", e))?
    }
    #[cfg(not(windows))]
    {
        let _ = data;
        Err("当前系统暂不支持复制图片".to_string())
    }
}


#[tauri::command]
pub async fn set_download_dir(dir: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut download_dir = state.download_dir.write().await;
    *download_dir = dir;
    Ok(())
}

#[tauri::command]
pub fn set_auto_start(enabled: bool, state: State<'_, AppState>) -> Result<(), String> {
    let _ = state.db.set_kv("auto_start", &enabled.to_string());
    configure_autostart(enabled)
}

#[tauri::command]
pub async fn register_global_hotkey(app: AppHandle, hotkey: String, state: State<'_, AppState>) -> Result<(), String> {
    let screenshot = state.db.get_kv("screenshot_hotkey").map_err(|e| e.to_string())?
        .unwrap_or_else(crate::default_screenshot_hotkey);
    update_hotkeys(&app, &state.db, &hotkey, &screenshot)
}

#[tauri::command]
pub async fn register_global_hotkeys(app: AppHandle, hotkey: String, screenshot_hotkey: String, state: State<'_, AppState>) -> Result<(), String> {
    update_hotkeys(&app, &state.db, &hotkey, &screenshot_hotkey)
}

#[tauri::command]
pub fn get_hotkey_errors(state: State<'_, HotkeyState>) -> Vec<String> {
    state.startup_errors.lock().map(|mut errors| std::mem::take(&mut *errors)).unwrap_or_default()
}

#[tauri::command]
pub fn set_hotkey_recording(recording: bool, state: State<'_, HotkeyState>) {
    state.recording.store(recording, std::sync::atomic::Ordering::Release);
}

#[tauri::command]
pub async fn request_notification_permission(_app: AppHandle) -> Result<bool, String> {
    Ok(true)
}

#[tauri::command]
pub async fn show_system_notification(
    app: AppHandle,
    title: String,
    body: String,
) -> Result<(), String> {
    send_desktop_notification(&app, &title, &body);
    Ok(())
}

#[tauri::command]
pub async fn is_window_visible(app: AppHandle) -> Result<bool, String> {
    if let Some(window) = app.get_webview_window("main") {
        let is_vis = window.is_visible().unwrap_or(false);
        let is_min = window.is_minimized().unwrap_or(false);
        let is_foc = window.is_focused().unwrap_or(false);
        return Ok(is_vis && !is_min && is_foc);
    }
    Ok(true)
}

#[tauri::command]
pub async fn exit_app(app: AppHandle) -> Result<(), String> {
    log::info!("正在安全退出应用...");
    app.exit(0);
    Ok(())
}

#[tauri::command]
pub async fn hide_to_tray(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
        let _ = window.set_skip_taskbar(true);
        let _ = window.emit("app://window_hidden_to_tray", true);
    }
    Ok(())
}

#[tauri::command]
pub async fn show_from_tray(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_skip_taskbar(false);
        let _ = window.set_always_on_top(true);
        let _ = window.set_focus();
        let _ = window.set_always_on_top(false);
        let _ = window.emit("app://restored_from_tray", ());
        let _ = window.emit("app://window_hidden_to_tray", false);
    }
    Ok(())
}

#[tauri::command]
pub async fn toggle_window(app: AppHandle) -> Result<(), String> {
    toggle_main_window(&app);
    Ok(())
}

#[tauri::command]
pub async fn check_for_updates(
    app: AppHandle,
    master_ip: String,
) -> Result<updater::UpdateCheckResult, String> {
    updater::check_and_perform_update(&app, &master_ip, true).await
}
