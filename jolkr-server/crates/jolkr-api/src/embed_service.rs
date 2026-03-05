use reqwest::Client;
use scraper::{Html, Selector};
use serde::Serialize;
use sqlx::PgPool;
use tracing::{debug, warn};
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
    regex::Regex::new(r"https?://[^\s<>\)\]]+").unwrap()
});

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
            match self.fetch_metadata(&url).await {
                Ok(Some(meta)) => {
                    let id = Uuid::new_v4();
                    let result = if is_dm {
                        EmbedRepo::create_dm(
                            pool,
                            id,
                            message_id,
                            &meta.url,
                            meta.title.as_deref(),
                            meta.description.as_deref(),
                            meta.image_url.as_deref(),
                            meta.site_name.as_deref(),
                            meta.color.as_deref(),
                        )
                        .await
                        .map(|_| ())
                    } else {
                        EmbedRepo::create(
                            pool,
                            id,
                            message_id,
                            &meta.url,
                            meta.title.as_deref(),
                            meta.description.as_deref(),
                            meta.image_url.as_deref(),
                            meta.site_name.as_deref(),
                            meta.color.as_deref(),
                        )
                        .await
                        .map(|_| ())
                    };

                    if let Err(e) = result {
                        warn!(message_id = %message_id, url = %url, error = %e, "Failed to store embed");
                    } else {
                        debug!(message_id = %message_id, url = %url, "Stored link embed");
                    }
                }
                Ok(None) => {
                    debug!(url = %url, "No metadata found for URL");
                }
                Err(e) => {
                    debug!(url = %url, error = %e, "Failed to fetch URL metadata");
                }
            }
        }
    }

    /// Fetch metadata (OG tags) from a URL.
    async fn fetch_metadata(&self, url: &str) -> Result<Option<EmbedMetadata>, String> {
        let response = self
            .client
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
    if s.len() <= max {
        s.to_string()
    } else {
        format!("{}…", &s[..max - 1])
    }
}
