// 局域网节点探测与同步 Tauri IPC 指令
use crate::state::AppState;
use tauri::{AppHandle, State};
use crate::discovery;

#[tauri::command]
pub async fn get_local_device(state: State<'_, AppState>) -> Result<discovery::DeviceInfo, String> {
    let dev = state.local_device.read().await;
    Ok(dev.clone())
}

#[tauri::command]
pub async fn sync_local_device(
    device: discovery::DeviceInfo,
    state: State<'_, AppState>,
) -> Result<discovery::DeviceInfo, String> {
    let mut dev = state.local_device.write().await;
    let real_ip = dev.ip.clone();
    let persistent_id = dev.id.clone();
    let listening_port = dev.port;
    *dev = device;
    if !persistent_id.is_empty() {
        dev.id = persistent_id;
    }
    if !real_ip.is_empty() && real_ip != "127.0.0.1" && real_ip != "0.0.0.0" {
        dev.ip = real_ip;
    }
    // 配置变更尚未重启监听服务，公告端口必须与当前监听端口一致。
    dev.port = listening_port;
    Ok(dev.clone())
}

#[tauri::command]
pub async fn update_local_device(name: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut dev = state.local_device.write().await;
    dev.name = name;
    Ok(())
}

#[tauri::command]
pub async fn trigger_discovery_scan(app: AppHandle, state: State<'_, AppState>) -> Result<Vec<discovery::DeviceInfo>, String> {
    let devices = discovery::scan_subnet_peers(&app, &state.local_device).await;
    Ok(devices)
}

#[tauri::command]
pub async fn probe_peer_ip(
    app: AppHandle,
    ip: String,
    port: Option<u16>,
    state: State<'_, AppState>,
) -> Result<discovery::DeviceInfo, String> {
    let local_port = { state.local_device.read().await.port };
    let default_fallback_port = if local_port > 0 { local_port } else { discovery::DEFAULT_PORT };
    let target_port = port.unwrap_or(default_fallback_port);
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(std::time::Duration::from_millis(2500))
        .connect_timeout(std::time::Duration::from_millis(1500))
        .build()
        .map_err(|e| e.to_string())?;

    // 优先探测目标端口
    let mut peer_opt = discovery::probe_single_peer(&client, &ip, target_port).await;
    
    // 若失败且目标端口不是 57088，尝试 57088
    if peer_opt.is_none() && target_port != discovery::DEFAULT_PORT {
        peer_opt = discovery::probe_single_peer(&client, &ip, discovery::DEFAULT_PORT).await;
    }
    // 若仍失败且目标端口不是 7890，尝试 7890
    if peer_opt.is_none() && target_port != 7890 {
        peer_opt = discovery::probe_single_peer(&client, &ip, 7890).await;
    }

    if let Some(peer) = peer_opt {
        let my_id = { state.local_device.read().await.id.clone() };
        if peer.id == my_id {
            return Err("无法添加本机自身".into());
        }

        discovery::register_peer(&app, peer.clone()).await;
        Ok(peer)
    } else {
        Err(format!("无法连接到 {}:{}，请检查对端 IP、端口与防火墙设置", ip, target_port))
    }
}
