// 窗口、托盘、系统通知与全局快捷键 Tauri IPC 指令
use crate::state::AppState;
use tauri::{AppHandle, Emitter, Manager, State};
use crate::updater;
use crate::{configure_autostart, parse_shortcut_str, toggle_main_window, send_desktop_notification};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};


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
    let _ = state.db.set_kv("global_hotkey", &hotkey);

    let _ = app.global_shortcut().unregister_all();

    let normalized = parse_shortcut_str(&hotkey);
    if !normalized.is_empty() {
        match normalized.parse::<Shortcut>() {
            Ok(shortcut) => {
                if let Err(e) = app.global_shortcut().register(shortcut) {
                    log::warn!("操作系统注册全局快捷键 '{}' 失败: {}", normalized, e);
                    return Err(format!("系统全局快捷键注册失败，可能被其他程序占用: {}", e));
                } else {
                    log::info!("成功注册新系统 OS 级全局唤醒快捷键: {}", normalized);
                }
            }
            Err(e) => {
                log::warn!("快捷键格式解析失败: {}", e);
            }
        }
    }

    Ok(())
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

