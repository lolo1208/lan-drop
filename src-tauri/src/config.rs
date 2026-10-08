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
    #[serde(rename = "screenshotHotkey", default = "default_screenshot_hotkey")]
    pub screenshot_hotkey: String,
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

pub fn default_screenshot_hotkey() -> String {
    "Ctrl+Alt+Shift+A".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn old_settings_get_default_but_empty_hotkeys_stay_disabled() {
        let mut value = serde_json::json!({
            "id": "测试设备", "name": "测试", "avatarUrl": "", "os": "windows",
            "ip": "127.0.0.1", "port": 57088, "downloadDir": ""
        });
        let old: AppSettingsPayload = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(old.screenshot_hotkey, "Ctrl+Alt+Shift+A");
        value["screenshotHotkey"] = serde_json::json!("");
        value["globalHotkey"] = serde_json::json!("");
        let disabled: AppSettingsPayload = serde_json::from_value(value).unwrap();
        assert!(disabled.screenshot_hotkey.is_empty());
        assert!(disabled.global_hotkey.is_empty());
    }
}
