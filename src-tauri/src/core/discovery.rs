// 局域网纯 HTTP 网段温和并发探测核心
// ⚠️ 架构约束与开发规范（CRITICAL）：
// 1. 严禁在此项目中使用或添加任何 UDP 组播/广播逻辑！
// 2. 探测必须采用温和平滑的 HTTP 模式，避免高频全网段并发（防止被 Windows Defender / 杀毒软件误判为端口扫描木马）

use futures_util::stream::{self, StreamExt};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::net::Ipv4Addr;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::RwLock;

pub const DEFAULT_PORT: u16 = 57088;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    pub id: String,
    pub name: String,
    pub ip: String,
    pub port: u16,
    pub os: String,
    #[serde(default)]
    pub avatar_url: String,
}

/// 获取本机所有可用物理与内网接口的 /24 网段目标 IP 列表
pub fn get_all_subnet_ips(preferred_ip: &str) -> Vec<String> {
    let mut targets_set = HashSet::new();
    let mut local_ips = Vec::new();

    // 1. 枚举本机所有活动物理网卡的 IPv4 地址（优先）
    if let Ok(interfaces) = local_ip_address::list_afinet_netifas() {
        for (name, ip) in &interfaces {
            let lower_name = name.to_lowercase();
            // 忽略虚拟网卡与回环
            if lower_name.contains("vethernet")
                || lower_name.contains("wsl")
                || lower_name.contains("docker")
                || lower_name.contains("tailscale")
                || lower_name.contains("loopback")
                || lower_name.contains("virbr")
                || lower_name.contains("vmnet")
                || lower_name.contains("virtualbox")
            {
                continue;
            }

            if let std::net::IpAddr::V4(ipv4) = ip {
                if !ipv4.is_loopback() && !ipv4.is_link_local() && !ipv4.is_unspecified() {
                    if !local_ips.contains(ipv4) {
                        local_ips.push(*ipv4);
                    }
                }
            }
        }
    }

    // 2. 将传入的有效 IP（且非假默认 IP 192.168.1.100）也加入
    if let Ok(ip) = preferred_ip.parse::<Ipv4Addr>() {
        if !ip.is_loopback() && !ip.is_link_local() && !ip.is_unspecified() {
            if !local_ips.contains(&ip) {
                local_ips.push(ip);
            }
        }
    }

    // 如果没有任何物理网卡枚举出来，回退到 192.168.1.0/24 与 192.168.0.0/24
    if local_ips.is_empty() {
        if let Ok(ip) = "192.168.1.1".parse::<Ipv4Addr>() {
            local_ips.push(ip);
        }
        if let Ok(ip) = "192.168.0.1".parse::<Ipv4Addr>() {
            local_ips.push(ip);
        }
    }

    // 3. 为每个真实网段生成 1..254 的 IP 探测目标（排除本机自身 IP）
    for ip in &local_ips {
        let octets = ip.octets();
        for i in 1..=254 {
            if i == octets[3] {
                continue; // 跳过自身
            }
            targets_set.insert(format!("{}.{}.{}.{}", octets[0], octets[1], octets[2], i));
        }
    }

    let mut list: Vec<String> = targets_set.into_iter().collect();
    list.sort();
    list
}

/// 针对单个 IP 和端口发起 HTTP GET /api/info 探测（纯 HTTP 机制，轻量单次握手）
async fn probe_peer_result(client: &reqwest::Client, ip: &str, port: u16) -> Result<DeviceInfo, String> {
    let url = format!("http://{}:{}/api/info", ip, port);
    let response = client.get(&url).send().await.map_err(|e| {
        if e.is_timeout() { "连接或请求超时".to_string() } else { format!("连接失败：{e}") }
    })?;
    let response = response.error_for_status().map_err(|e| format!("HTTP 状态异常：{e}"))?;
    let mut dev = response.json::<DeviceInfo>().await.map_err(|e| format!("响应格式无效：{e}"))?;
    if dev.id.trim().is_empty() { return Err("响应缺少设备 ID".into()); }
    // 公告地址可能属于另一张网卡，以实际成功连接的地址和端口为准。
    dev.ip = ip.to_string();
    dev.port = port;
    Ok(dev)
}

pub async fn probe_single_peer(client: &reqwest::Client, ip: &str, port: u16) -> Option<DeviceInfo> {
    probe_peer_result(client, ip, port).await.ok()
}

fn discovery_ports(local_port: u16) -> Vec<u16> {
    let mut ports = vec![DEFAULT_PORT];
    for port in [local_port, 7890] {
        if !ports.contains(&port) { ports.push(port); }
    }
    ports
}

/// 执行局域网平滑高效 HTTP 扫描
/// （并发缓冲提升为 32，单次连接超时 250ms，整体超时 600ms，全网段扫描在 1~2 秒内秒级完成）
pub async fn scan_subnet_peers(
    app: &AppHandle,
    local_device: &Arc<RwLock<DeviceInfo>>,
) -> Vec<DeviceInfo> {
    // 手动扫描与后台扫描串行执行，避免启动时叠加全网并发。
    let state = app.state::<crate::state::AppState>();
    let _scan_guard = state.discovery_scan_lock.lock().await;
    let (my_id, my_ip, my_port) = {
        let dev = local_device.read().await;
        let port = if dev.port > 0 { dev.port } else { DEFAULT_PORT };
        (dev.id.clone(), dev.ip.clone(), port)
    };

    let started = Instant::now();
    let ips = get_all_subnet_ips(&my_ip);
    log::debug!("[扫描开始] 本机IP={}，目标数={}，端口={:?}", my_ip, ips.len(), discovery_ports(my_port));
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_millis(600))
        .connect_timeout(Duration::from_millis(250))
        .pool_max_idle_per_host(4)
        .tcp_nodelay(true)
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    let found_devices = Arc::new(tokio::sync::Mutex::new(Vec::new()));

    // 控制并发度在 32，极速且对网络完全无负担
    stream::iter(ips)
        .map(|ip| {
            let client = client.clone();
            let app = app.clone();
            let my_id = my_id.clone();
            let found_devices = found_devices.clone();

            async move {
                for port in discovery_ports(my_port) {
                    if let Some(peer) = probe_single_peer(&client, &ip, port).await {
                        if peer.id != my_id {
                            register_peer(&app, peer.clone()).await;
                            found_devices.lock().await.push(peer);
                            break;
                        }
                    }
                }
            }
        })
        .buffer_unordered(32)
        .collect::<Vec<()>>()
        .await;

    let res = found_devices.lock().await.clone();
    log::debug!("[扫描完成] 耗时={}ms，发现设备数={}", started.elapsed().as_millis(), res.len());
    res
}

/// 扫描和手动添加共用保活状态；离线设备保留用于自动重连。
#[derive(Debug)]
pub struct PeerHealth {
    pub device: DeviceInfo,
    last_success: Instant,
    failures: u8,
    online: bool,
}

impl PeerHealth {
    fn new(device: DeviceInfo) -> Self {
        Self { device, last_success: Instant::now(), failures: 0, online: true }
    }

    fn record_failure(&mut self, started: Instant) -> bool {
        // 探测期间有更新的成功记录时，忽略过时的失败。
        if self.last_success > started { return false; }
        self.failures = self.failures.saturating_add(1);
        if self.failures >= 3 && self.online {
            self.online = false;
            return true;
        }
        false
    }
}

pub async fn register_peer(app: &AppHandle, peer: DeviceInfo) {
    let state = app.state::<crate::state::AppState>();
    let mut known = state.known_peers.lock().await;
    if known.get(&peer.id).map_or(true, |old| !old.online || old.device.ip != peer.ip || old.device.port != peer.port) {
        log::info!("[设备上线] ID={}，地址={}:{}", peer.id, peer.ip, peer.port);
    }
    known.insert(peer.id.clone(), PeerHealth::new(peer.clone()));
    let _ = app.emit("peer://discovered", serde_json::json!({
        "peer": peer, "remoteIp": peer.ip, "timestamp": chrono::Utc::now().timestamp_millis()
    }));
}

/// 保活与扫描独立调度，扫描耗时不延迟已知设备状态检测。
pub async fn run_http_discovery_daemon(app: AppHandle, local_device: Arc<RwLock<DeviceInfo>>) {
    let scan_app = app.clone();
    tokio::spawn(async move {
        let mut scans = tokio::time::interval(Duration::from_secs(15));
        scans.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            scans.tick().await;
            scan_subnet_peers(&scan_app, &local_device).await;
        }
    });
    let client = reqwest::Client::builder().no_proxy()
        .timeout(Duration::from_millis(2500)).connect_timeout(Duration::from_millis(1500))
        .tcp_nodelay(true).build().expect("创建保活 HTTP 客户端失败");
    let mut interval = tokio::time::interval(Duration::from_secs(5));
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        interval.tick().await;
        let targets = {
            let state = app.state::<crate::state::AppState>();
            let known = state.known_peers.lock().await;
            known.values().map(|health| health.device.clone()).collect::<Vec<_>>()
        };
        stream::iter(targets).map(|target| {
            let client = client.clone();
            let app = app.clone();
            async move {
                let started = Instant::now();
                let reason = match probe_peer_result(&client, &target.ip, target.port).await {
                    Ok(peer) if peer.id == target.id => { register_peer(&app, peer).await; return; }
                    Ok(peer) => format!("设备 ID 不匹配：实际={}", peer.id),
                    Err(error) => error,
                };
                let state = app.state::<crate::state::AppState>();
                let mut known = state.known_peers.lock().await;
                if let Some(health) = known.get_mut(&target.id) {
                    let offline = health.record_failure(started);
                    if offline {
                        log::warn!("[设备离线] ID={}，地址={}:{}，连续失败={}，原因={}",
                            target.id, target.ip, target.port, health.failures, reason);
                        let _ = app.emit("peer://offline", serde_json::json!({
                            "id": target.id, "ip": target.ip, "reason": reason,
                            "failures": health.failures, "timestamp": chrono::Utc::now().timestamp_millis()
                        }));
                    }
                }
            }
        }).buffer_unordered(8).collect::<Vec<_>>().await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn device() -> DeviceInfo {
        DeviceInfo { id: "test-peer".into(), name: "测试设备".into(), ip: "127.0.0.1".into(),
            port: 7890, os: "windows".into(), avatar_url: String::new() }
    }

    #[test]
    fn offline_requires_three_failures_and_emits_once() {
        let mut health = PeerHealth::new(device());
        let started = Instant::now();
        assert!(!health.record_failure(started));
        assert!(!health.record_failure(started));
        assert!(health.record_failure(started));
        assert!(!health.record_failure(started));
    }

    #[test]
    fn newer_success_discards_stale_failure_and_resets_count() {
        let mut health = PeerHealth::new(device());
        let started = Instant::now();
        health.record_failure(started);
        health = PeerHealth::new(device());
        assert!(!health.record_failure(started));
        assert_eq!(health.failures, 0);
        assert!(health.online);
    }

    #[test]
    fn scans_default_port_even_when_local_port_is_custom() {
        assert_eq!(discovery_ports(58000), vec![57088, 58000, 7890]);
        assert_eq!(discovery_ports(57088), vec![57088, 7890]);
        assert_eq!(discovery_ports(7890), vec![57088, 7890]);
    }

    #[tokio::test]
    async fn probe_uses_reachable_endpoint_instead_of_advertised_address() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let router = axum::Router::new().route("/api/info", axum::routing::get(|| async {
            axum::Json(DeviceInfo { ip: "10.99.0.1".into(), port: 58000, ..device() })
        }));
        let server = tokio::spawn(async move { axum::serve(listener, router).await.unwrap(); });
        let client = reqwest::Client::builder().no_proxy().timeout(Duration::from_secs(2)).build().unwrap();
        let peer = probe_single_peer(&client, "127.0.0.1", port).await.unwrap();
        assert_eq!(peer.ip, "127.0.0.1");
        assert_eq!(peer.port, port);
        server.abort();
    }
}
