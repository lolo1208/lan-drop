// 截图会话管理：保持主窗口可见，后台框选，保证异常时也能退出截图状态。
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Manager};

#[cfg(target_os = "windows")]
#[path = "screenshot_windows.rs"]
mod platform;

static CAPTURING: AtomicBool = AtomicBool::new(false);

pub fn is_capturing() -> bool {
    CAPTURING.load(Ordering::Acquire)
}

struct CaptureGuard;
impl Drop for CaptureGuard {
    fn drop(&mut self) {
        CAPTURING.store(false, Ordering::Release);
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotResult {
    pub cancelled: bool,
    pub png_base64: Option<String>,
    pub width: u32,
    pub height: u32,
    pub clipboard_error: Option<String>,
}

impl ScreenshotResult {
    pub fn cancelled() -> Self {
        Self {
            cancelled: true,
            png_base64: None,
            width: 0,
            height: 0,
            clipboard_error: None,
        }
    }
}

#[tauri::command]
pub async fn start_screenshot(app: AppHandle) -> Result<ScreenshotResult, String> {
    if !cfg!(target_os = "windows") {
        return Err("截图功能目前仅支持 Windows 桌面客户端".into());
    }
    if CAPTURING
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err("正在截图，请先完成或取消当前截图".into());
    }
    let _guard = CaptureGuard;
    let window = app.get_webview_window("main").ok_or("找不到主窗口")?;
    let focused = window.is_focused().map_err(|e| e.to_string())?;

    #[cfg(target_os = "windows")]
    let result = tauri::async_runtime::spawn_blocking(platform::capture)
        .await
        .map_err(|e| format!("截图线程异常：{}", e))
        .and_then(|result| result);
    #[cfg(not(target_os = "windows"))]
    let result = Err("截图功能目前仅支持 Windows 桌面客户端".to_string());

    // 仅归还原有焦点；截图过程不改变主窗口的可见性和最小化状态。
    if focused && window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(true) {
        if let Err(e) = window.set_focus() {
            log::warn!("截图后恢复窗口焦点失败：{}", e);
        }
    }
    result
}

/// 将反向拖拽及越界坐标转换为截图内部的物理像素矩形。
pub fn selection_rect(
    start: (i32, i32),
    end: (i32, i32),
    width: i32,
    height: i32,
) -> Option<(i32, i32, i32, i32)> {
    let left = start.0.min(end.0).clamp(0, width);
    let top = start.1.min(end.1).clamp(0, height);
    let right = start.0.max(end.0).clamp(0, width);
    let bottom = start.1.max(end.1).clamp(0, height);
    (right > left && bottom > top).then_some((left, top, right, bottom))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reverse_drag_and_out_of_bounds_are_clamped() {
        assert_eq!(
            selection_rect((200, 150), (-30, -10), 1920, 1080),
            Some((0, 0, 200, 150))
        );
        assert_eq!(
            selection_rect((1900, 1000), (2100, 1200), 1920, 1080),
            Some((1900, 1000, 1920, 1080))
        );
    }
    #[test]
    fn empty_selection_is_rejected() {
        assert_eq!(selection_rect((5, 5), (5, 100), 1920, 1080), None);
    }
    #[test]
    fn virtual_desktop_origin_does_not_change_crop() {
        let origin = (-1920, -200);
        let to_local = |p: (i32, i32)| (p.0 - origin.0, p.1 - origin.1);
        assert_eq!(
            selection_rect(to_local((-100, 0)), to_local((100, 200)), 3840, 1280),
            Some((1820, 200, 2020, 400))
        );
    }
}
