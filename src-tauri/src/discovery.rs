// LAN Drop (内网投送) - UDP 组播设备自动发现核心
use serde::{Deserialize, Serialize};
use socket2::{Domain, Protocol, Socket, Type};
use std::net::{Ipv4Addr, SocketAddrV4};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

pub const MULTICAST_ADDR: Ipv4Addr = Ipv4Addr::new(239, 255, 42, 99);
pub const MULTICAST_PORT: u16 = 7432;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceInfo {
    pub id: String,
    pub name: String,
    pub ip: String,
    pub port: u16,
    pub os: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub enum DiscoveryPacket {
    Heartbeat(DeviceInfo),
    Goodbye { id: String },
}

/// 运行 UDP 组播广播与监听引擎
pub async fn run_multicast_daemon(app: AppHandle, local: DeviceInfo) {
    let bind_addr = SocketAddrV4::new(Ipv4Addr::UNSPECIFIED, MULTICAST_PORT);
    let socket = Socket::new(Domain::IPV4, Type::DGRAM, Some(Protocol::UDP)).expect("Socket 创建失败");

    // 开启地址复用 SO_REUSEADDR，允许同一局域网机器多个实例共用端口
    socket.set_reuse_address(true).ok();
    #[cfg(not(target_os = "windows"))]
    socket.set_reuse_port(true).ok();

    socket.bind(&bind_addr.into()).expect("Socket 绑定失败");

    // 尝试解析 local.ip 为 Ipv4Addr，否则退回 UNSPECIFIED
    let local_ipv4 = local.ip.parse::<std::net::IpAddr>().ok().and_then(|ip| match ip {
        std::net::IpAddr::V4(v4) => Some(v4),
        _ => None,
    }).unwrap_or(Ipv4Addr::UNSPECIFIED);

    // 在指定的本地接口上加入组播，并设置出口网卡，避免多网卡(如虚拟网卡/VPN)路由乱窜
    socket.join_multicast_v4(&MULTICAST_ADDR, &local_ipv4).unwrap_or_else(|_| {
        socket.join_multicast_v4(&MULTICAST_ADDR, &Ipv4Addr::UNSPECIFIED).expect("加入组播组失败");
    });
    socket.set_multicast_if_v4(&local_ipv4).unwrap_or_else(|_| {
        socket.set_multicast_if_v4(&Ipv4Addr::UNSPECIFIED).ok();
    });
    
    socket.set_multicast_loop_v4(true).ok();

    let std_socket: std::net::UdpSocket = socket.into();
    std_socket.set_nonblocking(true).expect("设置非阻塞失败");
    let async_socket = Arc::new(tokio::net::UdpSocket::from_std(std_socket).expect("转换 tokio socket 失败"));

    // 任务 A: 定时向组播广播自身心跳 (每3秒一次)
    let send_socket = async_socket.clone();
    let local_clone = local.clone();
    tokio::spawn(async move {
        let dest = SocketAddrV4::new(MULTICAST_ADDR, MULTICAST_PORT);
        let mut interval = tokio::time::interval(Duration::from_secs(3));
        loop {
            interval.tick().await;
            let packet = DiscoveryPacket::Heartbeat(local_clone.clone());
            if let Ok(bytes) = serde_json::to_vec(&packet) {
                let _ = send_socket.send_to(&bytes, dest).await;
            }
        }
    });

    // 任务 B: 持续接收局域网内其他设备的心跳数据包
    let mut buf = [0u8; 2048];
    loop {
        match async_socket.recv_from(&mut buf).await {
            Ok((len, remote_addr)) => {
                if let Ok(packet) = serde_json::from_slice::<DiscoveryPacket>(&buf[..len]) {
                    match packet {
                        DiscoveryPacket::Heartbeat(remote_device) => {
                            // 过滤本机自身广播
                            if remote_device.id != local.id {
                                let _ = app.emit("peer://discovered", serde_json::json!({
                                    "peer": remote_device,
                                    "remoteIp": remote_addr.ip().to_string(),
                                    "timestamp": chrono::Utc::now().timestamp_millis()
                                }));
                            }
                        }
                        DiscoveryPacket::Goodbye { id } => {
                            let _ = app.emit("peer://offline", serde_json::json!({ "id": id }));
                        }
                    }
                }
            }
            Err(_) => {
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        }
    }
}
