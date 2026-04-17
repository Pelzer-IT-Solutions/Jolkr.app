//! GIF proxy — accepts Tenor v2-shaped requests from gif-picker-react,
//! translates them to GIPHY API calls, and returns Tenor v2-shaped responses.
//! ALL traffic (API + images) is proxied — users never connect to GIPHY.

use axum::body::Body;
use axum::extract::{Query, State};
use axum::http::{header, StatusCode};
use axum::response::Response;
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::errors::AppError;
use crate::middleware::auth::AuthUser;
use jolkr_db::repo::gif_favorites::GifFavoritesRepo;

use super::AppState;

const GIPHY_BASE: &str = "https://api.giphy.com/v1/gifs";

fn giphy_api_key() -> Result<String, (StatusCode, &'static str)> {
    std::env::var("GIPHY_API_KEY")
        .map_err(|_| (StatusCode::SERVICE_UNAVAILABLE, "GIF service not configured"))
}

/// Rewrite a GIPHY media URL to go through our proxy.
/// `https://media1.giphy.com/media/.../giphy.gif` → `/api/gifs/media?url=<encoded>`
fn proxy_url(original: &str) -> String {
    format!(
        "/api/gifs/media?url={}",
        urlencoding::encode(original)
    )
}

// ── Tenor v2-compatible response types (what gif-picker-react expects) ──

#[derive(Serialize)]
pub struct TenorMedia {
    url: String,
    dims: [u32; 2],
    size: u32,
}

#[derive(Serialize)]
pub struct TenorMediaFormats {
    gif: TenorMedia,
    tinygif: TenorMedia,
}

#[derive(Serialize)]
pub struct TenorResult {
    id: String,
    title: String,
    media_formats: TenorMediaFormats,
    created: f64,
    #[serde(rename = "content_description")]
    content_description: String,
    url: String,
}

#[derive(Serialize)]
pub struct TenorSearchResponse {
    results: Vec<TenorResult>,
    next: String,
}

#[derive(Serialize)]
pub struct TenorCategory {
    searchterm: String,
    path: String,
    image: String,
    name: String,
}

#[derive(Serialize)]
pub struct TenorCategoriesResponse {
    tags: Vec<TenorCategory>,
}

// ── GIPHY response types ────────────────────────────────────────

#[derive(Deserialize)]
struct GiphyResponse {
    data: Vec<GiphyGif>,
    pagination: GiphyPagination,
}

#[derive(Deserialize)]
struct GiphyPagination {
    count: u32,
    offset: u32,
}

#[derive(Deserialize)]
struct GiphySingleResponse {
    data: GiphyGif,
}

#[derive(Deserialize)]
struct GiphyGif {
    id: String,
    title: String,
    #[allow(dead_code)]
    url: String,
    images: GiphyImages,
}

#[derive(Deserialize)]
struct GiphyImages {
    original: GiphyImage,
    fixed_width_small: GiphyImage,
}

#[derive(Deserialize)]
struct GiphyImage {
    url: String,
    #[serde(default, deserialize_with = "de_str_u32")]
    width: u32,
    #[serde(default, deserialize_with = "de_str_u32")]
    height: u32,
    #[serde(default, deserialize_with = "de_str_u32")]
    size: u32,
}

fn de_str_u32<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<u32, D::Error> {
    let s = String::deserialize(deserializer)?;
    Ok(s.parse().unwrap_or(0))
}

fn giphy_to_tenor(giphy: GiphyResponse) -> TenorSearchResponse {
    let next_offset = giphy.pagination.offset + giphy.pagination.count;
    let results = giphy
        .data
        .into_iter()
        .map(|g| {
            // Store original URL for the "url" field (used when user selects a GIF to send)
            let original_gif_url = g.images.original.url.clone();
            TenorResult {
                id: g.id,
                title: g.title.clone(),
                content_description: g.title,
                url: original_gif_url,
                media_formats: TenorMediaFormats {
                    gif: TenorMedia {
                        url: proxy_url(&g.images.original.url),
                        dims: [g.images.original.width, g.images.original.height],
                        size: g.images.original.size,
                    },
                    tinygif: TenorMedia {
                        url: proxy_url(&g.images.fixed_width_small.url),
                        dims: [g.images.fixed_width_small.width, g.images.fixed_width_small.height],
                        size: g.images.fixed_width_small.size,
                    },
                },
                created: 0.0,
            }
        })
        .collect();
    TenorSearchResponse {
        results,
        next: next_offset.to_string(),
    }
}

// ── Handlers ────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct SearchParams {
    q: Option<String>,
    #[serde(default)]
    limit: Option<u8>,
    pos: Option<String>,
}

#[derive(Deserialize)]
pub struct TrendingParams {
    #[serde(default)]
    limit: Option<u8>,
    pos: Option<String>,
}

/// GET /api/gifs/search — Tenor v2-compatible search
pub async fn search_gifs(
    State(_state): State<AppState>,
    Query(params): Query<SearchParams>,
) -> Result<Json<TenorSearchResponse>, (StatusCode, &'static str)> {
    let key = giphy_api_key()?;
    let limit = params.limit.unwrap_or(30).min(50);
    let q = params.q.unwrap_or_default();

    let client = reqwest::Client::new();
    let mut req = client
        .get(format!("{GIPHY_BASE}/search"))
        .query(&[("api_key", key.as_str()), ("q", q.as_str()), ("rating", "g")])
        .query(&[("limit", limit)]);

    if let Some(pos) = &params.pos {
        if let Ok(offset) = pos.parse::<u32>() {
            req = req.query(&[("offset", offset)]);
        }
    }

    let resp = req.send().await
        .map_err(|_| (StatusCode::BAD_GATEWAY, "Failed to reach GIF service"))?;
    let giphy: GiphyResponse = resp.json().await
        .map_err(|_| (StatusCode::BAD_GATEWAY, "Invalid GIF service response"))?;

    Ok(Json(giphy_to_tenor(giphy)))
}

/// GET /api/gifs/featured — Tenor v2-compatible trending
pub async fn featured_gifs(
    State(_state): State<AppState>,
    Query(params): Query<TrendingParams>,
) -> Result<Json<TenorSearchResponse>, (StatusCode, &'static str)> {
    let key = giphy_api_key()?;
    let limit = params.limit.unwrap_or(30).min(50);

    let client = reqwest::Client::new();
    let mut req = client
        .get(format!("{GIPHY_BASE}/trending"))
        .query(&[("api_key", key.as_str()), ("rating", "g")])
        .query(&[("limit", limit)]);

    if let Some(pos) = &params.pos {
        if let Ok(offset) = pos.parse::<u32>() {
            req = req.query(&[("offset", offset)]);
        }
    }

    let resp = req.send().await
        .map_err(|_| (StatusCode::BAD_GATEWAY, "Failed to reach GIF service"))?;
    let giphy: GiphyResponse = resp.json().await
        .map_err(|_| (StatusCode::BAD_GATEWAY, "Invalid GIF service response"))?;

    Ok(Json(giphy_to_tenor(giphy)))
}

/// GET /api/gifs/categories — Tenor v2-compatible categories with preview images
pub async fn categories(
    State(_state): State<AppState>,
) -> Result<Json<TenorCategoriesResponse>, (StatusCode, &'static str)> {
    let key = giphy_api_key()?;
    let terms: Vec<(&str, &str)> = vec![
        ("Trending GIFs", "trending"),
        ("Reactions", "reactions"),
        ("Love", "love"),
        ("Happy", "happy"),
        ("Sad", "sad"),
        ("Angry", "angry"),
        ("Laugh", "laugh"),
        ("Dance", "dance"),
        ("Thumbs Up", "thumbs up"),
        ("Facepalm", "facepalm"),
        ("OMG", "omg"),
        ("Celebrate", "celebrate"),
        ("High Five", "high five"),
        ("Hug", "hug"),
        ("Eye Roll", "eye roll"),
        ("Applause", "applause"),
    ];

    // Fetch 1 GIF per category in parallel to get preview images
    let client = reqwest::Client::new();
    let mut handles = Vec::new();
    for (name, term) in &terms {
        let client = client.clone();
        let key = key.clone();
        let name = name.to_string();
        let term = term.to_string();
        handles.push(tokio::spawn(async move {
            let resp = client
                .get(format!("{GIPHY_BASE}/search"))
                .query(&[("api_key", key.as_str()), ("q", term.as_str()), ("rating", "g")])
                .query(&[("limit", 1u8)])
                .send()
                .await
                .ok()?;
            let giphy: GiphyResponse = resp.json().await.ok()?;
            let image = giphy.data.first().map(|g| {
                proxy_url(&g.images.fixed_width_small.url)
            }).unwrap_or_default();
            Some(TenorCategory {
                searchterm: term.clone(),
                path: format!("#{term}"),
                image,
                name: format!("#{name}"),
            })
        }));
    }

    let mut tags = Vec::new();
    for handle in handles {
        if let Ok(Some(cat)) = handle.await {
            tags.push(cat);
        }
    }

    Ok(Json(TenorCategoriesResponse { tags }))
}

/// GET /api/gifs/media?url=<encoded_giphy_url> — Image proxy
/// Fetches the GIF from GIPHY and streams it back to the client.
/// Only allows URLs from media*.giphy.com to prevent open proxy abuse.
#[derive(Deserialize)]
pub struct MediaParams {
    url: String,
}

pub async fn proxy_media(
    State(_state): State<AppState>,
    Query(params): Query<MediaParams>,
) -> Result<Response, (StatusCode, &'static str)> {
    // Allowlist: only proxy GIPHY media URLs
    let url = &params.url;
    let is_giphy = url.starts_with("https://media")
        && url.contains(".giphy.com/");
    if !is_giphy {
        return Err((StatusCode::FORBIDDEN, "Only GIPHY media URLs allowed"));
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "Client error"))?;

    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|_| (StatusCode::BAD_GATEWAY, "Failed to fetch media"))?;

    if !resp.status().is_success() {
        return Err((StatusCode::BAD_GATEWAY, "Upstream error"));
    }

    let content_type = resp
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/gif")
        .to_string();

    let bytes = resp
        .bytes()
        .await
        .map_err(|_| (StatusCode::BAD_GATEWAY, "Failed to read media"))?;

    Ok(Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CACHE_CONTROL, "public, max-age=86400, immutable")
        .body(Body::from(bytes))
        .unwrap())
}

// ── Favorites ──────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct AddFavoriteRequest {
    pub gif_id: String,
    #[serde(default)]
    pub gif_url: Option<String>,
    #[serde(default)]
    pub preview_url: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
}

#[derive(Serialize)]
pub struct FavoritesResponse {
    pub favorites: Vec<FavoriteItem>,
}

#[derive(Serialize)]
pub struct FavoriteItem {
    pub gif_id: String,
    pub gif_url: String,
    pub preview_url: String,
    pub title: String,
    pub added_at: String,
}

/// Fetch a single GIF from GIPHY by ID.
async fn fetch_giphy_gif(gif_id: &str) -> Result<GiphyGif, (StatusCode, &'static str)> {
    let key = giphy_api_key()?;
    let client = reqwest::Client::new();
    let url = format!("{GIPHY_BASE}/{gif_id}");
    tracing::debug!("Fetching GIF from GIPHY: {url}");
    let resp = client
        .get(&url)
        .query(&[("api_key", key.as_str())])
        .send()
        .await
        .map_err(|e| {
            tracing::error!("GIPHY request failed: {e}");
            (StatusCode::BAD_GATEWAY, "Failed to reach GIF service")
        })?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        tracing::error!("GIPHY returned {status}: {body}");
        return Err((StatusCode::NOT_FOUND, "GIF not found"));
    }
    let text = resp.text().await.map_err(|e| {
        tracing::error!("Failed to read GIPHY response body: {e}");
        (StatusCode::BAD_GATEWAY, "Failed to read GIF service response")
    })?;
    let single: GiphySingleResponse = serde_json::from_str(&text).map_err(|e| {
        tracing::error!("Failed to deserialize GIPHY response: {e}, body: {}", &text[..text.len().min(500)]);
        (StatusCode::BAD_GATEWAY, "Invalid GIF service response")
    })?;
    Ok(single.data)
}

/// GET /api/gifs/favorites — returns proxy URLs ready for display
pub async fn list_favorites(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<FavoritesResponse>, AppError> {
    let rows = GifFavoritesRepo::list(&state.pool, auth.user_id).await?;
    let favorites = rows
        .into_iter()
        .map(|r| FavoriteItem {
            gif_id: r.gif_id,
            gif_url: proxy_url(&r.gif_url),
            preview_url: proxy_url(&r.preview_url),
            title: r.title,
            added_at: r.added_at.to_rfc3339(),
        })
        .collect();
    Ok(Json(FavoritesResponse { favorites }))
}

/// POST /api/gifs/favorites — stores a GIF favorite.
/// If gif_url/preview_url are provided, stores them directly.
/// Otherwise falls back to looking up the GIF via GIPHY API.
pub async fn add_favorite(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(body): Json<AddFavoriteRequest>,
) -> Result<StatusCode, AppError> {
    let (gif_url, preview_url, title) = if let (Some(url), Some(prev)) = (&body.gif_url, &body.preview_url) {
        (url.clone(), prev.clone(), body.title.clone().unwrap_or_default())
    } else {
        // Fallback: look up from GIPHY API
        let gif = fetch_giphy_gif(&body.gif_id)
            .await
            .map_err(|(_status, msg)| {
                AppError(jolkr_common::JolkrError::BadRequest(msg.to_string()))
            })?;
        (gif.images.original.url, gif.images.fixed_width_small.url, gif.title)
    };

    GifFavoritesRepo::add(
        &state.pool,
        auth.user_id,
        &body.gif_id,
        &gif_url,
        &preview_url,
        &title,
    )
    .await?;
    Ok(StatusCode::CREATED)
}

/// DELETE /api/gifs/favorites/:gif_id
pub async fn remove_favorite(
    State(state): State<AppState>,
    auth: AuthUser,
    axum::extract::Path(gif_id): axum::extract::Path<String>,
) -> Result<StatusCode, AppError> {
    GifFavoritesRepo::remove(&state.pool, auth.user_id, &gif_id).await?;
    Ok(StatusCode::NO_CONTENT)
}
