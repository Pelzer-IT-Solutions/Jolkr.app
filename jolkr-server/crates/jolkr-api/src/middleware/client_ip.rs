use std::net::{IpAddr, SocketAddr};

use axum::http::HeaderMap;

/// True if `ip` is one of our infrastructure proxies (loopback or Docker bridge 172.16/12).
/// X-Forwarded-For from these sources is trusted; from any other source it is attacker-controlled.
pub(crate) fn is_trusted_proxy(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => v4.is_loopback() || (v4.octets()[0] == 172 && (v4.octets()[1] & 0xF0) == 16),
        IpAddr::V6(v6) => v6.is_loopback(),
    }
}

/// Resolve the real client IP from the connection peer plus X-Forwarded-For.
/// When the peer is a trusted proxy we walk XFF right-to-left and take the rightmost
/// non-trusted entry — that's the address our outermost proxy stamped. The leftmost
/// entry is attacker-controlled and must never be trusted.
pub(crate) fn resolve_client_ip(connect_addr: SocketAddr, headers: &HeaderMap) -> IpAddr {
    let connect_ip = connect_addr.ip();
    if is_trusted_proxy(connect_ip) {
        headers
            .get("x-forwarded-for")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| {
                s.split(',')
                    .rev()
                    .map(|p| p.trim())
                    .filter_map(|p| p.parse::<IpAddr>().ok())
                    .find(|ip| !is_trusted_proxy(*ip))
            })
            .unwrap_or(connect_ip)
    } else {
        connect_ip
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    fn xff(value: &str) -> HeaderMap {
        let mut h = HeaderMap::new();
        h.insert("x-forwarded-for", HeaderValue::from_str(value).unwrap());
        h
    }

    #[test]
    fn loopback_is_trusted() {
        assert!(is_trusted_proxy("127.0.0.1".parse().unwrap()));
        assert!(is_trusted_proxy("::1".parse().unwrap()));
    }

    #[test]
    fn docker_bridge_is_trusted() {
        assert!(is_trusted_proxy("172.16.0.1".parse().unwrap()));
        assert!(is_trusted_proxy("172.31.255.255".parse().unwrap()));
        assert!(!is_trusted_proxy("172.15.0.1".parse().unwrap()));
        assert!(!is_trusted_proxy("172.32.0.1".parse().unwrap()));
    }

    #[test]
    fn public_v4_is_not_trusted() {
        assert!(!is_trusted_proxy("8.8.8.8".parse().unwrap()));
        assert!(!is_trusted_proxy("192.168.1.1".parse().unwrap()));
    }

    #[test]
    fn direct_peer_returns_connect_ip_when_untrusted() {
        let peer: SocketAddr = "8.8.8.8:443".parse().unwrap();
        let h = xff("1.2.3.4, 5.6.7.8");
        assert_eq!(resolve_client_ip(peer, &h), "8.8.8.8".parse::<IpAddr>().unwrap());
    }

    #[test]
    fn rightmost_non_trusted_is_picked() {
        let peer: SocketAddr = "127.0.0.1:443".parse().unwrap();
        let h = xff("1.2.3.4, 8.8.8.8, 172.17.0.1");
        assert_eq!(resolve_client_ip(peer, &h), "8.8.8.8".parse::<IpAddr>().unwrap());
    }

    #[test]
    fn falls_back_to_connect_ip_when_xff_all_trusted() {
        let peer: SocketAddr = "127.0.0.1:443".parse().unwrap();
        let h = xff("172.17.0.1, 127.0.0.1");
        assert_eq!(resolve_client_ip(peer, &h), "127.0.0.1".parse::<IpAddr>().unwrap());
    }

    #[test]
    fn falls_back_to_connect_ip_when_no_xff() {
        let peer: SocketAddr = "127.0.0.1:443".parse().unwrap();
        let h = HeaderMap::new();
        assert_eq!(resolve_client_ip(peer, &h), "127.0.0.1".parse::<IpAddr>().unwrap());
    }
}
