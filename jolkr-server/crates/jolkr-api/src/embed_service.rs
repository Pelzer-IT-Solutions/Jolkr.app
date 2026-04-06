use std::net::IpAddr;

use reqwest::Client;
use scraper::{Html, Selector};
use serde::Serialize;
use sqlx::PgPool;
use tracing::{debug, info, warn};
use uuid::Uuid;

use jolkr_db::repo::EmbedRepo;

/// Extracted metadata from a URL.
#[derive(Debug, Clone, Serialize)]
pub struct EmbedMetadata {
    pub url: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub image_url: Option<String>,
    pub site_name: Option<String>,
    pub color: Option<String>,
}

/// URL regex for extracting links from message content.
static URL_REGEX: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
    regex::Regex::new(r"https?://[^\s<>\)\]']+").unwrap()
});

/// YouTube URL patterns
static YOUTUBE_REGEX: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
    regex::Regex::new(r"(?:youtube\.com/(?:watch\?v=|shorts/|live/|embed/)|youtu\.be/)([a-zA-Z0-9_-]{11})").unwrap()
});

/// Vimeo URL pattern
static VIMEO_REGEX: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
    regex::Regex::new(r"vimeo\.com/(\d+)").unwrap()
});

/// Twitch URL patterns
static TWITCH_REGEX: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
    regex::Regex::new(r"twitch\.tv/(?:videos/(\d+)|([a-zA-Z0-9_]+))").unwrap()
});

/// TikTok URL pattern
static TIKTOK_REGEX: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
    regex::Regex::new(r"tiktok\.com/.*/video/(\d+)").unwrap()
});

/// Direct video file extensions
static DIRECT_VIDEO_REGEX: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
    regex::Regex::new(r"\.(mp4|webm|ogg|mov|m3u8)(\?.*)?$").unwrap()
});

/// Check if a URL is safe to fetch (not internal/private network).
/// Blocks: private IPs, localhost, link-local, cloud metadata, Docker hostnames.
/// Also resolves DNS to prevent rebinding attacks (hostname→private IP).
async fn is_safe_url(raw_url: &str) -> bool {
    let parsed = match url::Url::parse(raw_url) {
        Ok(u) => u,
        Err(_) => return false,
    };
    match parsed.scheme() {
        "http" | "https" => {}
        _ => return false,
    }
    let host = match parsed.host_str() {
        Some(h) => h.to_lowercase(),
        None => return false,
    };
    let blocked = [
        "localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0",
        "jolkr-api", "jolkr-media", "postgres", "redis", "minio", "nats",
        "mailhog", "jolkr_api", "jolkr_media",
        "metadata.google.internal",
    ];
    if blocked.contains(&host.as_str()) {
        return false;
    }
    if let Ok(ip) = host.parse::<IpAddr>() {
        return is_public_ip(ip);
    }
    // DNS resolution on blocking thread pool to avoid starving async workers.
    // Also prevents DNS rebinding attacks where a hostname resolves to a private IP.
    let port = parsed.port_or_known_default().unwrap_or(80);
    let host_owned = host.clone();
    let dns_result = tokio::task::spawn_blocking(move || {
        std::net::ToSocketAddrs::to_socket_addrs(&(host_owned.as_str(), port))
            .ok()
            .map(|addrs| addrs.collect::<Vec<_>>())
    })
    .await;

    match dns_result {
        Ok(Some(addrs)) if !addrs.is_empty() => {
            for addr in &addrs {
                if !is_public_ip(addr.ip()) {
                    return false;
                }
            }
            true // All resolved IPs are public → safe
        }
        _ => false, // DNS failed, empty, or task panicked → block
    }
}

fn is_public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            !v4.is_private()
                && !v4.is_loopback()
                && !v4.is_link_local()
                && !v4.is_unspecified()
                && !v4.is_broadcast()
                && !v4.is_documentation()
                && !(v4.octets()[0] == 100 && v4.octets()[1] >= 64 && v4.octets()[1] <= 127)
        }
        IpAddr::V6(v6) => {
            !v6.is_loopback()
                && !v6.is_unspecified()
                && !(v6.segments()[0] & 0xfe00 == 0xfc00)
                && !(v6.segments()[0] & 0xffc0 == 0xfe80)
        }
    }
}

/// Service for fetching link previews and storing them as embeds.
#[derive(Clone)]
pub struct LinkEmbedService {
    client: Client,
}

impl LinkEmbedService {
    pub fn new() -> Self {
        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(5))
            .user_agent("JolkrBot/1.0 (link preview)")
            .redirect(reqwest::redirect::Policy::limited(3))
            .build()
            .unwrap_or_else(|_| Client::new());

        Self { client }
    }

    /// Resolve DNS and build a one-shot client pinned to validated IPs.
    /// This prevents DNS rebinding TOCTOU attacks.
    fn build_pinned_client(url: &str) -> Result<(Client, String), String> {
        let parsed = url::Url::parse(url).map_err(|e| e.to_string())?;
        let host = parsed.host_str().ok_or("No host")?.to_string();
        let port = parsed.port_or_known_default().unwrap_or(80);

        // Resolve DNS synchronously (called from async context via spawn_blocking)
        let addrs: Vec<std::net::SocketAddr> = std::net::ToSocketAddrs::to_socket_addrs(&(host.as_str(), port))
            .map_err(|e| e.to_string())?
            .collect();

        if addrs.is_empty() {
            return Err("DNS resolution returned no addresses".to_string());
        }

        // Validate ALL resolved IPs are public
        for addr in &addrs {
            if !is_public_ip(addr.ip()) {
                return Err(format!("Resolved IP {} is not public", addr.ip()));
            }
        }

        // Pin the client to use only these validated IPs
        let mut builder = Client::builder()
            .timeout(std::time::Duration::from_secs(5))
            .user_agent("JolkrBot/1.0 (link preview)")
            .redirect(reqwest::redirect::Policy::none()); // No redirects — we handle them manually

        for addr in &addrs {
            builder = builder.resolve(&host, *addr);
        }

        let client = builder.build().map_err(|e| e.to_string())?;
        Ok((client, host))
    }

    /// Try to generate embed metadata for known video platforms without scraping.
    fn try_video_embed(url: &str) -> Option<EmbedMetadata> {
        // YouTube
        if let Some(caps) = YOUTUBE_REGEX.captures(url) {
            let video_id = caps.get(1)?.as_str();
            return Some(EmbedMetadata {
                url: url.to_string(),
                title: Some("YouTube".to_string()),
                description: None,
                image_url: Some(format!("https://img.youtube.com/vi/{video_id}/mqdefault.jpg")),
                site_name: Some("YouTube".to_string()),
                color: Some("#FF0000".to_string()),
            });
        }

        // Vimeo
        if let Some(caps) = VIMEO_REGEX.captures(url) {
            let _video_id = caps.get(1)?.as_str();
            return Some(EmbedMetadata {
                url: url.to_string(),
                title: Some("Vimeo".to_string()),
                description: None,
                image_url: None,
                site_name: Some("Vimeo".to_string()),
                color: Some("#1AB7EA".to_string()),
            });
        }

        // Twitch
        if TWITCH_REGEX.is_match(url) {
            return Some(EmbedMetadata {
                url: url.to_string(),
                title: Some("Twitch".to_string()),
                description: None,
                image_url: None,
                site_name: Some("Twitch".to_string()),
                color: Some("#9146FF".to_string()),
            });
        }

        // TikTok
        if TIKTOK_REGEX.is_match(url) {
            return Some(EmbedMetadata {
                url: url.to_string(),
                title: Some("TikTok".to_string()),
                description: None,
                image_url: None,
                site_name: Some("TikTok".to_string()),
                color: Some("#EE1D52".to_string()),
            });
        }

        // Direct video files
        if DIRECT_VIDEO_REGEX.is_match(url) {
            return Some(EmbedMetadata {
                url: url.to_string(),
                title: Some("Video".to_string()),
                description: None,
                image_url: None,
                site_name: Some("Video".to_string()),
                color: Some("#5865F2".to_string()),
            });
        }

        None
    }

    /// Extract URLs from message content and fetch embeds for each.
    /// This is fire-and-forget — errors are logged but not propagated.
    pub async fn process_message(
        &self,
        pool: &PgPool,
        message_id: Uuid,
        content: &str,
        is_dm: bool,
    ) {
        let urls: Vec<String> = URL_REGEX
            .find_iter(content)
            .take(5) // Max 5 embeds per message
            .map(|m| m.as_str().to_string())
            .collect();

        if urls.is_empty() {
            return;
        }

        for url in urls {
            // SSRF protection: skip private/internal URLs
            if !is_safe_url(&url).await {
                warn!(url = %url, "Skipping unsafe URL (SSRF protection)");
                continue;
            }

            // First try known video platforms (no scraping needed)
            let meta = if let Some(video_meta) = Self::try_video_embed(&url) {
                info!(url = %url, site = ?video_meta.site_name, "Generated video embed directly");
                Some(video_meta)
            } else {
                // Fallback to OG scraping for other URLs
                match self.fetch_metadata(&url).await {
                    Ok(meta) => meta,
                    Err(e) => {
                        warn!(url = %url, error = %e, "Failed to fetch URL metadata");
                        None
                    }
                }
            };

            if let Some(meta) = meta {
                let id = Uuid::new_v4();
                let result = if is_dm {
                    EmbedRepo::create_dm(
                        pool, id, message_id, &meta.url,
                        meta.title.as_deref(), meta.description.as_deref(),
                        meta.image_url.as_deref(), meta.site_name.as_deref(),
                        meta.color.as_deref(),
                    ).await.map(|_| ())
                } else {
                    EmbedRepo::create(
                        pool, id, message_id, &meta.url,
                        meta.title.as_deref(), meta.description.as_deref(),
                        meta.image_url.as_deref(), meta.site_name.as_deref(),
                        meta.color.as_deref(),
                    ).await.map(|_| ())
                };

                if let Err(e) = result {
                    warn!(message_id = %message_id, url = %url, error = %e, "Failed to store embed");
                } else {
                    debug!(message_id = %message_id, url = %url, "Stored link embed");
                }
            } else {
                info!(url = %url, "No metadata found for URL");
            }
        }
    }

    /// Fetch metadata (OG tags) from a URL.
    /// Uses DNS-pinned client to prevent TOCTOU / DNS rebinding attacks.
    async fn fetch_metadata(&self, url: &str) -> Result<Option<EmbedMetadata>, String> {
        // Defense-in-depth: re-check URL safety
        if !is_safe_url(url).await {
            return Err("URL targets internal network".to_string());
        }

        // Resolve DNS and pin connection to validated IPs (prevents DNS rebinding)
        let url_owned = url.to_string();
        let (pinned_client, _host) = tokio::task::spawn_blocking(move || {
            Self::build_pinned_client(&url_owned)
        })
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("DNS pinning failed: {e}"))?;

        let response = pinned_client
            .get(url)
            .header("Accept", "text/html")
            .send()
            .await
            .map_err(|e| e.to_string())?;

        // Only process HTML responses
        let content_type = response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");

        if !content_type.contains("text/html") {
            return Ok(None);
        }

        // Limit body size to 512KB to prevent abuse
        let body = response
            .text()
            .await
            .map_err(|e| e.to_string())?;

        if body.len() > 512 * 1024 {
            return Ok(None);
        }

        let doc = Html::parse_document(&body);

        let og_title = Self::get_meta_content(&doc, "og:title");
        let og_desc = Self::get_meta_content(&doc, "og:description");
        let og_image = Self::get_meta_content(&doc, "og:image");
        let og_site = Self::get_meta_content(&doc, "og:site_name");
        let theme_color = Self::get_meta_content(&doc, "theme-color");

        // Fallback to <title> tag if no og:title
        let title = og_title.or_else(|| {
            let sel = Selector::parse("title").ok()?;
            doc.select(&sel).next().map(|e| e.text().collect::<String>())
        });

        // Fallback to meta description if no og:description
        let description = og_desc.or_else(|| {
            Self::get_meta_by_name(&doc, "description")
        });

        // If we got nothing useful, skip
        if title.is_none() && description.is_none() && og_image.is_none() {
            return Ok(None);
        }

        Ok(Some(EmbedMetadata {
            url: url.to_string(),
            title: title.map(|s| truncate(&s, 256)),
            description: description.map(|s| truncate(&s, 1024)),
            image_url: og_image,
            site_name: og_site.map(|s| truncate(&s, 100)),
            color: theme_color,
        }))
    }

    fn get_meta_content(doc: &Html, property: &str) -> Option<String> {
        let selector = Selector::parse(&format!(r#"meta[property="{}"]"#, property)).ok()?;
        doc.select(&selector)
            .next()
            .and_then(|e| e.value().attr("content").map(|s| s.to_string()))
    }

    fn get_meta_by_name(doc: &Html, name: &str) -> Option<String> {
        let selector = Selector::parse(&format!(r#"meta[name="{}"]"#, name)).ok()?;
        doc.select(&selector)
            .next()
            .and_then(|e| e.value().attr("content").map(|s| s.to_string()))
    }
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let end = s.char_indices()
            .nth(max.saturating_sub(1))
            .map_or(s.len(), |(i, _)| i);
        format!("{}…", &s[..end])
    }
}
