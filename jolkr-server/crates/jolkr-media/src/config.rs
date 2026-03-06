/// Media server configuration.
#[derive(Debug, Clone)]
pub struct Config {
    /// HTTP/WS server port (default: 8081).
    pub http_port: u16,
    /// UDP port for WebRTC media (default: 10000).
    pub udp_port: u16,
    /// Public IP address for ICE candidates.
    /// In Docker, set to the host's public IP or the container's IP.
    pub public_ip: String,
    /// Optional LAN IP for ICE candidates (avoids NAT hairpinning for local clients).
    pub local_ip: Option<String>,
    /// JWT secret for token validation (must match the API server).
    pub jwt_secret: String,
}

impl Config {
    pub fn from_env() -> Self {
        Self {
            http_port: std::env::var("MEDIA_PORT")
                .unwrap_or_else(|_| "8081".into())
                .parse()
                .expect("MEDIA_PORT must be a valid u16"),
            udp_port: std::env::var("MEDIA_UDP_PORT")
                .unwrap_or_else(|_| "10000".into())
                .parse()
                .expect("MEDIA_UDP_PORT must be a valid u16"),
            public_ip: std::env::var("PUBLIC_IP")
                .unwrap_or_else(|_| "0.0.0.0".into()),
            local_ip: std::env::var("LOCAL_IP").ok(),
            jwt_secret: std::env::var("JWT_SECRET")
                .expect("JWT_SECRET environment variable must be set"),
        }
    }
}
