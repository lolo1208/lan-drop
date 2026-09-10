// 智能挑选最优真实局域网 IP（避开 WSL/Docker/虚拟网卡）
use std::net::IpAddr;

pub fn detect_best_local_ip() -> IpAddr {
    if let Ok(interfaces) = local_ip_address::list_afinet_netifas() {
        // 第一优先级：物理网卡上的 192.168.x.x
        for (name, ip) in &interfaces {
            let lower_name = name.to_lowercase();
            if lower_name.contains("vethernet")
                || lower_name.contains("wsl")
                || lower_name.contains("docker")
                || lower_name.contains("tailscale")
                || lower_name.contains("vmnet")
                || lower_name.contains("virtualbox")
            {
                continue;
            }

            if let IpAddr::V4(ipv4) = ip {
                let octets = ipv4.octets();
                if octets[0] == 192 && octets[1] == 168 && !ipv4.is_loopback() {
                    return IpAddr::V4(*ipv4);
                }
            }
        }

        // 第二优先级：物理网卡上的 10.x.x.x
        for (name, ip) in &interfaces {
            let lower_name = name.to_lowercase();
            if lower_name.contains("vethernet")
                || lower_name.contains("wsl")
                || lower_name.contains("docker")
                || lower_name.contains("tailscale")
            {
                continue;
            }

            if let IpAddr::V4(ipv4) = ip {
                let octets = ipv4.octets();
                if octets[0] == 10 && !ipv4.is_loopback() {
                    return IpAddr::V4(*ipv4);
                }
            }
        }

        // 第三优先级：物理网卡上的 172.16-31.x.x
        for (name, ip) in &interfaces {
            let lower_name = name.to_lowercase();
            if lower_name.contains("vethernet")
                || lower_name.contains("wsl")
                || lower_name.contains("docker")
                || lower_name.contains("tailscale")
            {
                continue;
            }

            if let IpAddr::V4(ipv4) = ip {
                let octets = ipv4.octets();
                if octets[0] == 172 && octets[1] >= 16 && octets[1] <= 31 && !ipv4.is_loopback() {
                    return IpAddr::V4(*ipv4);
                }
            }
        }

        // 第四优先级：任意非虚拟、非 loopback 的 IPv4
        for (_name, ip) in &interfaces {
            if let IpAddr::V4(ipv4) = ip {
                if !ipv4.is_loopback() && !ipv4.is_link_local() && !ipv4.is_unspecified() {
                    return IpAddr::V4(*ipv4);
                }
            }
        }
    }

    local_ip_address::local_ip().unwrap_or_else(|_| IpAddr::V4(std::net::Ipv4Addr::new(127, 0, 0, 1)))
}
