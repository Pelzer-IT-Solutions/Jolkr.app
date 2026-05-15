use axum::{
    body::Body,
    extract::{Path, State},
    http::{header, Response, StatusCode},
};
use uuid::Uuid;

use jolkr_db::repo::UserRepo;
use jolkr_db::repo::ServerRepo;

use crate::routes::AppState;

/// Max avatar size served to clients (2x retina of 56px max display = 112, round to 128).
const SERVE_MAX_PX: u32 = 128;

/// GET /api/avatars/:user_id
///
/// Serves the user's avatar image directly from S3, resized to 128×128 WebP.
/// No authentication required — avatars are public.
/// Nginx caches the response so the resize only happens once per avatar.
pub(crate) async fn get_user_avatar(
    State(state): State<AppState>,
    Path(user_id): Path<Uuid>,
) -> Result<Response<Body>, StatusCode> {
    let user = UserRepo::get_by_id(&state.pool, user_id)
        .await
        .map_err(|e| {
            tracing::warn!(?e, "avatar: user lookup failed → 404");
            StatusCode::NOT_FOUND
        })?;

    let key = user.avatar_url.ok_or(StatusCode::NOT_FOUND)?;

    if key.starts_with("http") {
        return Response::builder()
            .status(StatusCode::TEMPORARY_REDIRECT)
            .header(header::LOCATION, &key)
            .header(header::CACHE_CONTROL, "public, max-age=3600")
            .body(Body::empty())
            .map_err(|e| {
                tracing::warn!(?e, "avatar redirect response builder failed");
                StatusCode::INTERNAL_SERVER_ERROR
            });
    }

    serve_resized_avatar(&state, &key).await
}

/// GET /api/icons/:server_id
///
/// Serves the server's icon image directly from S3, resized to 128×128 WebP.
/// No authentication required — server icons are public.
pub(crate) async fn get_server_icon(
    State(state): State<AppState>,
    Path(server_id): Path<Uuid>,
) -> Result<Response<Body>, StatusCode> {
    let server = ServerRepo::get_by_id(&state.pool, server_id)
        .await
        .map_err(|e| {
            tracing::warn!(?e, "server icon: server lookup failed → 404");
            StatusCode::NOT_FOUND
        })?;

    let key = server.icon_url.ok_or(StatusCode::NOT_FOUND)?;

    if key.starts_with("http") {
        return Response::builder()
            .status(StatusCode::TEMPORARY_REDIRECT)
            .header(header::LOCATION, &key)
            .header(header::CACHE_CONTROL, "public, max-age=3600")
            .body(Body::empty())
            .map_err(|e| {
                tracing::warn!(?e, "server icon redirect response builder failed");
                StatusCode::INTERNAL_SERVER_ERROR
            });
    }

    serve_resized_avatar(&state, &key).await
}

/// Fetch from S3, resize to SERVE_MAX_PX, encode as WebP, return with cache headers.
async fn serve_resized_avatar(state: &AppState, key: &str) -> Result<Response<Body>, StatusCode> {
    let (raw_data, content_type) = state
        .storage
        .get_object(key)
        .await
        .map_err(|e| {
            if e == "not_found" { StatusCode::NOT_FOUND } else { StatusCode::INTERNAL_SERVER_ERROR }
        })?;

    // Resize + convert to WebP (handles PNG, JPEG, WebP, GIF, SVG, etc.)
    // This uses the same convert_to_webp pipeline but with our serve-time max (128px)
    let webp_data = resize_to_webp(&raw_data, &content_type)
        .map_err(|e| {
            tracing::warn!(?e, "avatar/icon WebP resize failed");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    let etag = format!("\"{}\"", &key.replace('/', "-"));

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "image/webp")
        .header(header::CACHE_CONTROL, "public, max-age=86400, stale-while-revalidate=604800")
        .header(header::ETAG, &etag)
        .header("Vary", "Accept-Encoding")
        .body(Body::from(webp_data))
        .map_err(|e| {
            tracing::warn!(?e, "avatar/icon response builder failed");
            StatusCode::INTERNAL_SERVER_ERROR
        })
}

/// Resize an image to SERVE_MAX_PX and encode as WebP.
/// If already small enough and already WebP, the conversion still normalizes the size.
fn resize_to_webp(data: &[u8], content_type: &str) -> Result<Vec<u8>, String> {
    use image::imageops::FilterType;
    use std::io::Cursor;

    let img = if content_type.eq_ignore_ascii_case("image/svg+xml") {
        // SVG → rasterize (reuse image_processing module would be ideal,
        // but we inline a simpler raster path here)
        image::ImageReader::new(Cursor::new(data))
            .with_guessed_format()
            .map_err(|e| e.to_string())?
            .decode()
            .map_err(|e| e.to_string())?
    } else {
        image::ImageReader::new(Cursor::new(data))
            .with_guessed_format()
            .map_err(|e| e.to_string())?
            .decode()
            .map_err(|e| e.to_string())?
    };

    // Resize if larger than SERVE_MAX_PX
    let img = if img.width() > SERVE_MAX_PX || img.height() > SERVE_MAX_PX {
        img.resize(SERVE_MAX_PX, SERVE_MAX_PX, FilterType::Lanczos3)
    } else {
        img
    };

    let mut buf = Cursor::new(Vec::new());
    img.write_to(&mut buf, image::ImageFormat::WebP)
        .map_err(|e| format!("WebP encode failed: {e}"))?;

    Ok(buf.into_inner())
}
