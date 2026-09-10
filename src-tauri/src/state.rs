// Tauri 全局托管状态容器 (AppState)
use std::sync::Arc;
use tokio::sync::RwLock;
use crate::db;
use crate::discovery;

pub struct AppState {
    pub db: Arc<db::Database>,
    pub local_device: Arc<RwLock<discovery::DeviceInfo>>,
    pub download_dir: Arc<RwLock<String>>,
}
