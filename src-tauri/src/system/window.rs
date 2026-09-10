// 窗口交互与单实例进程控制
use std::net::{TcpListener, TcpStream};
use tauri::{AppHandle, Emitter, Manager};

pub const SINGLE_INSTANCE_PORT: u16 = 57087;

/// 规范化快捷键输入字符串
pub fn parse_shortcut_str(s: &str) -> String {
    let raw = s.trim().to_lowercase();
    if raw.is_empty() {
        return "".into();
    }
    let mut parts = Vec::new();
    for p in raw.split('+') {
        let trimmed = p.trim();
        match trimmed {
            "ctrl" | "control" => parts.push("ctrl"),
            "cmd" | "command" | "meta" | "win" => parts.push("super"),
            "alt" | "option" => parts.push("alt"),
            "shift" => parts.push("shift"),
            "space" => parts.push("space"),
            _ => parts.push(trimmed),
        }
    }
    parts.join("+")
}

/// 切换主窗口前台激活/后台托盘隐藏状态
pub fn toggle_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let is_visible = window.is_visible().unwrap_or(false);
        let is_minimized = window.is_minimized().unwrap_or(false);
        let is_focused = window.is_focused().unwrap_or(false);

        // 如果主窗口当前处于可见、未最小化且处于聚焦前台激活状态
        if is_visible && !is_minimized && is_focused {
            log::info!("主窗口当前处于前台激活状态，按下快捷键隐藏至系统托盘");
            let _ = window.hide();
            let _ = window.set_skip_taskbar(true);
            let _ = window.emit("app://window_hidden_to_tray", true);
        } else {
            log::info!("主窗口处于后台或未聚焦，按下快捷键呼出并恢复至前台");
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_skip_taskbar(false);
            let _ = window.set_always_on_top(true);
            let _ = window.set_focus();
            let _ = window.set_always_on_top(false);
            let _ = window.emit("app://restored_from_tray", ());
            let _ = window.emit("app://window_hidden_to_tray", false);
        }
    }
}

/// 唤醒并置顶主窗口
pub fn wake_main_window(app: &AppHandle) {
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
}

/// 单实例运行控制：保证程序同时只可以运行一个，重复双击启动时自动唤醒后台已有窗口并直接退出
pub fn ensure_single_instance() -> Option<TcpListener> {
    match TcpListener::bind(("127.0.0.1", SINGLE_INSTANCE_PORT)) {
        Ok(listener) => Some(listener),
        Err(_) => {
            println!("LAN Drop 程序已经在运行中，正在唤醒已存在的实例...");
            if let Ok(mut stream) = TcpStream::connect(("127.0.0.1", SINGLE_INSTANCE_PORT)) {
                use std::io::Write;
                let _ = stream.write_all(b"WAKEUP\n");
            }
            std::process::exit(0);
        }
    }
}
