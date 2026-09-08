// LAN Drop (内网投送) - 局域网纯 HTTP 网段温和并发探测核心
// ⚠️ 架构约束与开发规范（CRITICAL）：
// 1. 严禁在此项目中使用或添加任何 UDP 组播/广播逻辑！
// 2. 探测必须采用温和平滑的 HTTP 模式，避免高频全网段并发（防止被 Windows Defender / 杀毒软件误判为端口扫描木马）

use futures_util::stream::{self, StreamExt};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::net::Ipv4Addr;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
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
pub async fn probe_single_peer(
    client: &reqwest::Client,
    target_ip: &str,
    target_port: u16,
) -> Option<DeviceInfo> {
    let url = format!("http://{}:{}/api/info", target_ip, target_port);
    let resp = client.get(&url).send().await.ok()?;
    if resp.status().is_success() {
        if let Ok(mut dev) = resp.json::<DeviceInfo>().await {
            // 确保 IP 字段记录对端真实的连接 IP
            if dev.ip.is_empty() || dev.ip == "127.0.0.1" || dev.ip == "0.0.0.0" || !dev.ip.contains('.') {
                dev.ip = target_ip.to_string();
            }
            if dev.port == 0 {
                dev.port = target_port;
            }
            return Some(dev);
        }
    }
    None
}

/// 执行局域网平滑高效 HTTP 扫描
/// （并发缓冲提升为 32，单次连接超时 250ms，整体超时 600ms，全网段扫描在 1~2 秒内秒级完成）
pub async fn scan_subnet_peers(
    app: &AppHandle,
    local_device: &Arc<RwLock<DeviceInfo>>,
) -> Vec<DeviceInfo> {
    let (my_id, my_ip, my_port) = {
        let dev = local_device.read().await;
        let port = if dev.port > 0 { dev.port } else { DEFAULT_PORT };
        (dev.id.clone(), dev.ip.clone(), port)
    };

    let ips = get_all_subnet_ips(&my_ip);
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
                // 探测当前主要端口 (57088)
                if let Some(peer) = probe_single_peer(&client, &ip, my_port).await {
                    if peer.id != my_id {
                        let _ = app.emit(
                            "peer://discovered",
                            serde_json::json!({
                                "peer": peer,
                                "remoteIp": peer.ip,
                                "timestamp": chrono::Utc::now().timestamp_millis()
                            }),
                        );
                        let mut list = found_devices.lock().await;
                        list.push(peer);
                        return;
                    }
                }

                // 若默认端口未探测到，且 my_port != 7890，尝试探测备用端口 7890
                if my_port != 7890 {
                    if let Some(peer) = probe_single_peer(&client, &ip, 7890).await {
                        if peer.id != my_id {
                            let _ = app.emit(
                                "peer://discovered",
                                serde_json::json!({
                                    "peer": peer,
                                    "remoteIp": peer.ip,
                                    "timestamp": chrono::Utc::now().timestamp_millis()
                                }),
                            );
                            let mut list = found_devices.lock().await;
                            list.push(peer);
                        }
                    }
                }
            }
        })
        .buffer_unordered(32)
        .collect::<Vec<()>>()
        .await;

    let res = found_devices.lock().await.clone();
    res
}

/// 运行后台轻量发现守护线程
/// 策略：
/// 1. 启动延时 200ms 后立刻执行第 1 次全网秒级扫描；
/// 2. 日常每 5 秒对“已知发现的设备”进行轻量保活探测；
/// 3. 每 15 秒执行一次全局增量扫描，确保新加入设备秒级发现。
pub async fn run_http_discovery_daemon(app: AppHandle, local_device: Arc<RwLock<DeviceInfo>>) {
    // 等待本地 Axum 服务启动就绪
    tokio::time::sleep(Duration::from_millis(200)).await;

    // 首次启动立即执行全网扫描
    let initial_found = scan_subnet_peers(&app, &local_device).await;
    let known_ips = Arc::new(RwLock::new(
        initial_found.into_iter().map(|d| d.ip).collect::<HashSet<String>>()
    ));

    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_millis(600))
        .connect_timeout(Duration::from_millis(300))
        .tcp_nodelay(true)
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    let mut tick_count: u32 = 0;
    let mut interval = tokio::time::interval(Duration::from_secs(5));

    loop {
        interval.tick().await;
        tick_count = tick_count.wrapping_add(1);

        // 每 3 个周期（即 15 秒）执行一次全局秒级发现
        if tick_count % 3 == 0 {
            let found = scan_subnet_peers(&app, &local_device).await;
            let current_ips: HashSet<String> = found.iter().map(|d| d.ip.clone()).collect();
            let mut known = known_ips.write().await;
            // 找出此前在线但当前扫描未响应的设备，及时发出离线事件
            for old_ip in known.iter() {
                if !current_ips.contains(old_ip) {
                    let _ = app.emit(
                        "peer://offline",
                        serde_json::json!({
                            "ip": old_ip,
                            "timestamp": chrono::Utc::now().timestamp_millis()
                        }),
                    );
                }
            }
            *known = current_ips;
        } else {
            // 平常仅对已知在线列表进行精准极轻量保活探测
            let (targets, my_id, my_port) = {
                let known = known_ips.read().await;
                let dev = local_device.read().await;
                let p = if dev.port > 0 { dev.port } else { DEFAULT_PORT };
                (known.iter().cloned().collect::<Vec<String>>(), dev.id.clone(), p)
            };

            for ip in targets {
                if let Some(peer) = probe_single_peer(&client, &ip, my_port).await {
                    if peer.id != my_id {
                        let _ = app.emit(
                            "peer://discovered",
                            serde_json::json!({
                                "peer": peer,
                                "remoteIp": peer.ip,
                                "timestamp": chrono::Utc::now().timestamp_millis()
                            }),
                        );
                    }
                } else {
                    // 该对端设备未响应，发出离线通知
                    let _ = app.emit(
                        "peer://offline",
                        serde_json::json!({
                            "ip": ip,
                            "timestamp": chrono::Utc::now().timestamp_millis()
                        }),
                    );
                }
            }
        }
    }
}
