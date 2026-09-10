// 应用配置实体与默认值
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AppSettingsPayload {
    pub id: String,
    pub name: String,
    #[serde(rename = "avatarUrl")]
    pub avatar_url: String,
    pub os: String,
    pub ip: String,
    pub port: u16,
    #[serde(rename = "multicastGroup", default = "default_multicast_group")]
    pub multicast_group: String,
    #[serde(rename = "autoAccept", default)]
    pub auto_accept: bool,
    #[serde(rename = "downloadDir")]
    pub download_dir: String,
    #[serde(rename = "heartbeatInterval", default = "default_heartbeat_interval")]
    pub heartbeat_interval: u32,
    #[serde(rename = "updateUrl", default)]
    pub update_url: String,
    #[serde(rename = "autoStart", default)]
    pub auto_start: bool,
    #[serde(rename = "globalHotkey", default = "default_global_hotkey")]
    pub global_hotkey: String,
}

pub fn default_multicast_group() -> String {
    "239.255.42.99:7432".to_string()
}

pub fn default_heartbeat_interval() -> u32 {
    10
}

pub fn default_global_hotkey() -> String {
    "Ctrl+Alt+Shift+S".to_string()
}
