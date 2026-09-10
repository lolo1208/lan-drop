// Tauri v2 主程序入口
// ⚠️ 架构约束规范（CRITICAL）：
// 严禁在此项目中使用或添加任何 UDP 组播/广播逻辑！
// 局域网设备探测全部基于 HTTP 并发探测（GET /api/info），通信全部基于 HTTP/TCP（默认端口 57088）。
// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

pub mod commands;
pub mod config;
pub mod core;
pub mod server;
pub mod state;
pub mod system;

// 重新导出核心业务引擎、系统能力与配置实体，保证模块调用平滑解耦
pub use config::*;
pub use core::*;
pub use system::*;

use state::AppState;
use std::sync::Arc;
use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tokio::sync::RwLock;

#[tokio::main]
async fn main() {
    // 0. 单实例运行控制：保证程序同时只可以运行一个，重复双击启动时自动唤醒后台已有窗口并直接退出
    let single_instance_listener = ensure_single_instance();

    tracing_subscriber::fmt::init();

    // 1. 初始化 SQLite 数据库与获取持久化设备唯一标识
    // 数据库路径规范："[用户文档]/LAN Drop/data.db"
    let lan_drop_dir = dirs::document_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("LAN Drop");
    let _ = std::fs::create_dir_all(&lan_drop_dir);

    let db_path = lan_drop_dir.join("data.db");
    let old_db_path = lan_drop_dir.join("lan_drop.db");
    let old_root_db = std::path::PathBuf::from("lan_drop.db");

    // 平滑迁移旧数据库文件（若存在旧版 lan_drop.db 且 data.db 尚不存在）
    if !db_path.exists() {
        if old_db_path.exists() {
            let _ = std::fs::rename(&old_db_path, &db_path);
        } else if old_root_db.exists() {
            let _ = std::fs::rename(&old_root_db, &db_path);
        }
    }

    let database = Arc::new(
        db::Database::init(&db_path.to_string_lossy())
            .expect("无法初始化数据库 [用户文档]/LAN Drop/data.db"),
    );

    let node_id = match database.get_kv("node_id") {
        Ok(Some(id)) if !id.is_empty() => id,
        _ => {
            let new_id = format!("node-{}", uuid::Uuid::new_v4().simple());
            let _ = database.set_kv("node_id", &new_id);
            new_id
        }
    };

    // 从 SQLite 持久化恢复用户自定义的偏好设置
    let saved_name = database.get_kv("user_name").ok().flatten();
    let saved_avatar = match database.get_kv("avatar_url") {
        Ok(Some(avatar)) if !avatar.trim().is_empty() => avatar,
        _ => {
            // 用户首次上线或初次启动应用时，自动随机抽取 0~10 中的任意一个 (11个预设头像) 作为默认头像并持久化
            let rand_num = (uuid::Uuid::new_v4().as_u128() % 11) as u8;
            let random_avatar = rand_num.to_string();
            let _ = database.set_kv("avatar_url", &random_avatar);
            log::info!("首次启动应用，已为用户随机抽取并保存默认头像 ID: {}", random_avatar);
            random_avatar
        }
    };
    let saved_port = database
        .get_kv("port")
        .ok()
        .flatten()
        .and_then(|p| p.parse::<u16>().ok())
        .unwrap_or(discovery::DEFAULT_PORT);
    let saved_download_dir = database.get_kv("download_dir").ok().flatten();
    let saved_auto_start = database
        .get_kv("auto_start")
        .ok()
        .flatten()
        .map(|s| s == "true")
        .unwrap_or(false);

    if let Err(e) = configure_autostart(saved_auto_start) {
        log::warn!("初始化系统开机自启动状态失败: {}", e);
    }

    // 2. 获取本地最优网络信息与设备标识
    let local_ip = detect_best_local_ip();
    let hostname = whoami::fallible::hostname().unwrap_or_else(|_| "Desktop".into());
    let final_name = saved_name.filter(|s| !s.trim().is_empty()).unwrap_or(hostname);
    let final_port = if saved_port >= 1024 { saved_port } else { discovery::DEFAULT_PORT };

    let local_info = discovery::DeviceInfo {
        id: node_id,
        name: final_name,
        ip: local_ip.to_string(),
        port: final_port,
        os: std::env::consts::OS.to_string(),
        avatar_url: saved_avatar,
    };

    let local_state = Arc::new(RwLock::new(local_info.clone()));

    let default_doc_dir_path = dirs::document_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("LAN Drop")
        .join("Files");
    let _ = std::fs::create_dir_all(&default_doc_dir_path);
    let default_media_dir_path = dirs::document_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("LAN Drop")
        .join("Media");
    let _ = std::fs::create_dir_all(&default_media_dir_path);
    let default_doc_dir = default_doc_dir_path.to_string_lossy().to_string();

    let final_download_dir = saved_download_dir
        .filter(|d| !d.trim().is_empty() && !d.contains("\\Users\\User\\") && !d.contains("/Users/User/"))
        .unwrap_or(default_doc_dir);

    let download_dir = Arc::new(RwLock::new(final_download_dir));

    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        log::info!("底层操作系统捕获到全局热键: {:?}", shortcut);
                        toggle_main_window(app);
                    }
                })
                .build(),
        )
        .manage(AppState {
            db: database.clone(),
            local_device: local_state.clone(),
            download_dir: download_dir.clone(),
        })
        .setup(move |app| {
            let handle = app.handle().clone();

            // 0. 启动单实例通信监听：收到后续二次启动进程发来的唤醒指令时，自动恢复并置顶现有主窗口
            if let Some(listener) = single_instance_listener {
                let single_handle = app.handle().clone();
                let _ = listener.set_nonblocking(true);
                tokio::spawn(async move {
                    if let Ok(tokio_listener) = tokio::net::TcpListener::from_std(listener) {
                        while let Ok((mut socket, _)) = tokio_listener.accept().await {
                            let mut buf = [0u8; 32];
                            use tokio::io::AsyncReadExt;
                            if let Ok(n) = socket.read(&mut buf).await {
                                if n > 0 {
                                    log::info!("收到单实例唤醒消息，自动恢复置顶主窗口");
                                    if let Some(window) = single_handle.get_webview_window("main") {
                                        let _ = window.show();
                                        let _ = window.unminimize();
                                        let _ = window.set_focus();
                                        let _ = window.set_skip_taskbar(false);
                                        let _ = window.emit("app://restored_from_tray", ());
                                    }
                                }
                            }
                        }
                    }
                });
            }

            // 1. 创建系统托盘图标（Tray Icon）与右键菜单（打开、退出）
            tray::create_tray(app)?;

            // 2. 启动纯 HTTP 网段设备并发探测守护线程 (⚠️ 禁止添加 UDP 组播/广播逻辑)
            let disc_handle = handle.clone();
            let disc_local_state = local_state.clone();
            tokio::spawn(async move {
                discovery::run_http_discovery_daemon(disc_handle, disc_local_state).await;
            });

            // 3. 启动 Axum 异步 HTTP 接收服务 (支持流式接收，不占大内存)
            let server_handle = handle.clone();
            let server_db = database.clone();
            let server_port = local_info.port;
            let server_download_dir = download_dir.clone();
            let server_local_state = local_state.clone();
            tokio::spawn(async move {
                server::start_axum_server(
                    server_handle,
                    server_db,
                    server_port,
                    server_download_dir,
                    server_local_state,
                )
                .await;
            });

            // 4. 启动局域网 Master 静默自动更新守护协程（启动 5 秒后首次检查，随后每 30 分钟静默检测一次）
            let update_handle = handle.clone();
            let update_db = database.clone();
            let update_local_state = local_state.clone();
            tokio::spawn(async move {
                tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
                loop {
                    if let Ok(Some(master_ip)) = update_db.get_kv("update_url") {
                        let clean_ip = master_ip.trim();
                        let my_ip = update_local_state.read().await.ip.clone();
                        if !clean_ip.is_empty()
                            && clean_ip != my_ip
                            && clean_ip != "127.0.0.1"
                            && clean_ip != "localhost"
                        {
                            log::info!("正在静默检查 Master 局域网更新源: {}", clean_ip);
                            let _ = updater::check_and_perform_update(&update_handle, clean_ip, false).await;
                        }
                    }
                    tokio::time::sleep(tokio::time::Duration::from_secs(1800)).await;
                }
            });

            // 5. 注册 OS 系统级全局唤醒快捷键（默认为 "Ctrl+Alt+Shift+S"）
            let initial_hotkey = database
                .get_kv("global_hotkey")
                .ok()
                .flatten()
                .filter(|s| !s.trim().is_empty())
                .unwrap_or_else(|| "Ctrl+Alt+Shift+S".to_string());

            let normalized = parse_shortcut_str(&initial_hotkey);
            if !normalized.is_empty() {
                if let Ok(shortcut) = normalized.parse::<Shortcut>() {
                    let _ = handle.global_shortcut().register(shortcut);
                    log::info!("系统初始化完成：成功注册 OS 系统级全局唤醒快捷键: {}", normalized);
                }
            }

            #[cfg(debug_assertions)]
            {
                if let Some(window) = handle.get_webview_window("main") {
                    let _ = window.open_devtools();
                }
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // 点击应用窗口的关闭按钮时，不要退出程序，而是在程序栏不再显示，只显示任务栏托盘图标
                api.prevent_close();
                let _ = window.hide();
                let _ = window.set_skip_taskbar(true);
            }
        })
        .invoke_handler(commands::get_handlers())
        .run(tauri::generate_context!())
        .expect("启动 Tauri 应用失败");
}
