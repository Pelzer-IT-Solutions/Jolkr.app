//! GIF proxy — translates requests to GIPHY API calls and proxies all media.
//! The frontend NEVER sees GIPHY URLs. All images are served via `/api/gifs/i/{id}`.

use axum::body::Body;
use axum::extract::{Path, Query, State};
use axum::http::{header, StatusCode};
use axum::response::Response;
use axum::Json;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{LazyLock, RwLock};

use crate::errors::AppError;
use crate::middleware::auth::AuthUser;
use jolkr_db::repo::gif_favorites::GifFavoritesRepo;

use super::AppState;

const GIPHY_BASE: &str = "https://api.giphy.com/v1/gifs";

fn giphy_api_key() -> Result<String, (StatusCode, &'static str)> {
    std::env::var("GIPHY_API_KEY")
        .map_err(|_| (StatusCode::SERVICE_UNAVAILABLE, "GIF service not configured"))
}

// ── URL cache: gif_id → (original_url, small_url) ──────────────

/// In-memory cache mapping GIPHY IDs to their CDN URLs.
/// Populated during search/featured/categories; read by the image proxy + favorites.
static GIF_URL_CACHE: LazyLock<RwLock<HashMap<String, (String, String)>>> =
    LazyLock::new(|| RwLock::new(HashMap::new()));

/// Cached categories response (refreshed every 30 minutes to avoid rate limits).
static CATEGORIES_CACHE: LazyLock<RwLock<Option<(std::time::Instant, TenorCategoriesResponse)>>> =
    LazyLock::new(|| RwLock::new(None));

fn cache_gif(id: &str, original: &str, small: &str) {
    if let Ok(mut cache) = GIF_URL_CACHE.write() {
        cache.insert(id.to_string(), (original.to_string(), small.to_string()));
    }
}

fn get_cached(id: &str) -> Option<(String, String)> {
    GIF_URL_CACHE.read().ok()?.get(id).cloned()
}

/// Clean proxy URL — no GIPHY details leak to the frontend.
fn proxy_url(gif_id: &str, size: &str) -> String {
    format!("/api/gifs/i/{gif_id}/{size}")
}

// ── Tenor v2-compatible response types ──────────────────────────

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

#[derive(Serialize, Clone)]
pub struct TenorCategory {
    searchterm: String,
    path: String,
    image: String,
    name: String,
}

#[derive(Serialize, Clone)]
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

/// Convert GIPHY response to Tenor v2 format, caching all URLs.
fn giphy_to_tenor(giphy: GiphyResponse) -> TenorSearchResponse {
    let next_offset = giphy.pagination.offset + giphy.pagination.count;
    let results = giphy
        .data
        .into_iter()
        .map(|g| {
            // Cache the raw GIPHY CDN URLs for the image proxy
            cache_gif(&g.id, &g.images.original.url, &g.images.fixed_width_small.url);

            TenorResult {
                id: g.id.clone(),
                title: g.title.clone(),
                content_description: g.title,
                // url field: clean proxy URL (used when user selects GIF to send as message)
                url: proxy_url(&g.id, "original"),
                media_formats: TenorMediaFormats {
                    gif: TenorMedia {
                        url: proxy_url(&g.id, "original"),
                        dims: [g.images.original.width, g.images.original.height],
                        size: g.images.original.size,
                    },
                    tinygif: TenorMedia {
                        url: proxy_url(&g.id, "small"),
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

// ── Search / Featured / Categories handlers ─────────────────────

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

/// GET /api/gifs/search
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

/// GET /api/gifs/featured
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

/// GET /api/gifs/categories — cached for 30 minutes to avoid rate limits
pub async fn categories(
    State(_state): State<AppState>,
) -> Result<Json<TenorCategoriesResponse>, (StatusCode, &'static str)> {
    // Return cached response if fresh (< 30 minutes old)
    if let Ok(guard) = CATEGORIES_CACHE.read() {
        if let Some((created, cached)) = guard.as_ref() {
            if created.elapsed() < std::time::Duration::from_secs(1800) {
                return Ok(Json(cached.clone()));
            }
        }
    }

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
            let gif = giphy.data.first()?;
            // Cache this GIF too
            cache_gif(&gif.id, &gif.images.original.url, &gif.images.fixed_width_small.url);
            Some(TenorCategory {
                searchterm: term.clone(),
                path: format!("#{term}"),
                image: proxy_url(&gif.id, "small"),
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

    let response = TenorCategoriesResponse { tags };

    // Cache the response for 30 minutes
    if let Ok(mut guard) = CATEGORIES_CACHE.write() {
        *guard = Some((std::time::Instant::now(), response.clone()));
    }

    Ok(Json(response))
}

// ── Image proxy ────────────────────────────────────────────────

/// Fetch and stream a GIPHY CDN URL back to the client.
async fn stream_giphy_url(url: &str) -> Result<Response, (StatusCode, &'static str)> {
    // Allowlist: only proxy GIPHY media URLs
    let is_giphy = url.starts_with("https://media") && url.contains(".giphy.com/");
    if !is_giphy {
        return Err((StatusCode::FORBIDDEN, "Only GIPHY media URLs allowed"));
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "Client error"))?;

    let resp = client.get(url).send().await
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

    let bytes = resp.bytes().await
        .map_err(|_| (StatusCode::BAD_GATEWAY, "Failed to read media"))?;

    Ok(Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CACHE_CONTROL, "public, max-age=86400, immutable")
        .body(Body::from(bytes))
        .unwrap())
}

/// GET /api/gifs/i/:gif_id/:size — Clean image proxy by GIF ID.
/// Resolves the GIPHY CDN URL from cache or GIPHY API, then streams it.
pub async fn proxy_gif_image(
    State(state): State<AppState>,
    Path((gif_id, size)): Path<(String, String)>,
) -> Result<Response, (StatusCode, &'static str)> {
    let url = resolve_gif_url(&state, &gif_id, &size).await?;
    stream_giphy_url(&url).await
}

/// Resolve a GIPHY CDN URL for a gif_id + size ("original" or "small").
/// Checks: 1) in-memory cache, 2) gif_favorites DB table, 3) GIPHY API fallback.
async fn resolve_gif_url(
    state: &AppState,
    gif_id: &str,
    size: &str,
) -> Result<String, (StatusCode, &'static str)> {
    // 1. Check in-memory cache
    if let Some((original, small)) = get_cached(gif_id) {
        return Ok(if size == "small" { small } else { original });
    }

    // 2. Check gif_favorites table (any user's entry for this gif_id)
    if let Ok(Some(row)) = GifFavoritesRepo::find_by_gif_id(&state.pool, gif_id).await {
        // Re-populate cache for future requests
        cache_gif(gif_id, &row.gif_url, &row.preview_url);
        return Ok(if size == "small" { row.preview_url } else { row.gif_url });
    }

    // 3. Fallback: fetch from GIPHY API
    let gif = fetch_giphy_gif(gif_id).await?;
    cache_gif(&gif.id, &gif.images.original.url, &gif.images.fixed_width_small.url);
    Ok(if size == "small" {
        gif.images.fixed_width_small.url
    } else {
        gif.images.original.url
    })
}

/// GET /api/gifs/media?url=<encoded_giphy_url> — Legacy image proxy (for old messages).
#[derive(Deserialize)]
pub struct MediaParams {
    url: String,
}

pub async fn proxy_media(
    State(_state): State<AppState>,
    Query(params): Query<MediaParams>,
) -> Result<Response, (StatusCode, &'static str)> {
    stream_giphy_url(&params.url).await
}

/// Fetch a single GIF from GIPHY by ID (API fallback, used rarely).
async fn fetch_giphy_gif(gif_id: &str) -> Result<GiphyGif, (StatusCode, &'static str)> {
    let key = giphy_api_key()?;
    let client = reqwest::Client::new();
    let resp = client
        .get(format!("{GIPHY_BASE}/{gif_id}"))
        .query(&[("api_key", key.as_str())])
        .send()
        .await
        .map_err(|_| (StatusCode::BAD_GATEWAY, "Failed to reach GIF service"))?;
    if !resp.status().is_success() {
        return Err((StatusCode::BAD_GATEWAY, "GIF not found"));
    }
    let single: GiphySingleResponse = resp.json().await
        .map_err(|_| (StatusCode::BAD_GATEWAY, "Invalid GIF service response"))?;
    Ok(single.data)
}

// ── Favorites ──────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct AddFavoriteRequest {
    pub gif_id: String,
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

/// GET /api/gifs/favorites — returns clean proxy URLs
pub async fn list_favorites(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<FavoritesResponse>, AppError> {
    let rows = GifFavoritesRepo::list(&state.pool, auth.user_id).await?;
    let favorites = rows
        .into_iter()
        .map(|r| {
            // Re-populate cache from DB
            cache_gif(&r.gif_id, &r.gif_url, &r.preview_url);
            FavoriteItem {
                gif_url: proxy_url(&r.gif_id, "original"),
                preview_url: proxy_url(&r.gif_id, "small"),
                gif_id: r.gif_id,
                title: r.title,
                added_at: r.added_at.to_rfc3339(),
            }
        })
        .collect();
    Ok(Json(FavoritesResponse { favorites }))
}

/// POST /api/gifs/favorites — only needs gif_id; URLs are resolved from cache.
pub async fn add_favorite(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(body): Json<AddFavoriteRequest>,
) -> Result<StatusCode, AppError> {
    // Resolve raw GIPHY URLs (cache → DB → GIPHY API)
    let (gif_url, preview_url, title) = match get_cached(&body.gif_id) {
        Some((original, small)) => (original, small, String::new()),
        None => {
            let gif = fetch_giphy_gif(&body.gif_id)
                .await
                .map_err(|(_s, msg)| AppError(jolkr_common::JolkrError::BadRequest(msg.to_string())))?;
            cache_gif(&gif.id, &gif.images.original.url, &gif.images.fixed_width_small.url);
            (gif.images.original.url, gif.images.fixed_width_small.url, gif.title)
        }
    };

    GifFavoritesRepo::add(&state.pool, auth.user_id, &body.gif_id, &gif_url, &preview_url, &title).await?;
    Ok(StatusCode::CREATED)
}

/// DELETE /api/gifs/favorites/:gif_id
pub async fn remove_favorite(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(gif_id): Path<String>,
) -> Result<StatusCode, AppError> {
    GifFavoritesRepo::remove(&state.pool, auth.user_id, &gif_id).await?;
    Ok(StatusCode::NO_CONTENT)
}
