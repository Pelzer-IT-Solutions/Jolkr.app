//! Authenticated file-streaming endpoint for message attachments.
//!
//! Two routes work together:
//!   * `GET /api/files/:attachment_id`        — bytes (Range-aware)
//!   * `GET /api/files/:attachment_id/url`    — short-lived stream URL
//!
//! The bytes endpoint accepts EITHER a regular `Authorization: Bearer ...`
//! header (used by `useAuthedFileUrl` / blob fetches for images) OR a
//! `?t=<stream-token>` query parameter (so `<video src>` and `<audio src>`
//! can stream without an auth header). Range requests are proxied directly
//! to MinIO so playback can start before the full file is downloaded and
//! seeking issues fresh range requests instead of replaying.

use std::sync::OnceLock;

use axum::{
    extract::{Path, Query, State},
    http::{header, request::Parts, HeaderMap, HeaderName, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::errors::AppError;
use crate::middleware::auth::AuthUser;
use crate::routes::AppState;
use crate::stream_token;

/// Per-attachment metadata cache. The total size + content-type don't change
/// over the lifetime of an upload (attachments are immutable on our side),
/// so we can stash them after the first HEAD and skip the extra MinIO
/// round-trip on every subsequent Range request — turning each playback
/// segment fetch from "HEAD + GET" into just "GET".
struct AttachmentMeta {
    total: u64,
    s3_key: String,
    content_type: String,
}

fn meta_cache() -> &'static DashMap<Uuid, AttachmentMeta> {
    static CACHE: OnceLock<DashMap<Uuid, AttachmentMeta>> = OnceLock::new();
    CACHE.get_or_init(DashMap::new)
}

/// Bytes per Range chunk we'll fetch from S3 in a single hop. Large enough
/// that a video element rarely issues more than a handful of requests, small
/// enough that we never load >8 MB into the API process at once.
const RANGE_CHUNK_CAP: u64 = 8 * 1024 * 1024;

/// Query parameters for GET /api/files/:attachment_id.
#[derive(Deserialize)]
pub(crate) struct FileQuery {
    /// Optional stream token; required for unauthenticated callers (i.e.
    /// browser media elements that can't supply an Authorization header).
    t: Option<String>,
}

/// GET /api/files/:attachment_id
///
/// Streams the attachment bytes. Honors the `Range` request header and
/// returns `206 Partial Content` for ranged requests, `200 OK` for full
/// downloads. Authenticates via Bearer header OR `?t=<stream-token>`.
pub(crate) async fn serve_file(
    State(state): State<AppState>,
    parts: Parts,
    Path(attachment_id): Path<Uuid>,
    Query(q): Query<FileQuery>,
) -> Result<Response, AppError> {
    let auth = resolve_user(&state, &parts, attachment_id, q.t.as_deref())?;

    // Resolve attachment metadata. Cache hit short-circuits the whole DB
    // join chain (`AttachmentRepo::get_by_id` → `MessageRepo` → `ChannelRepo`
    // → `MemberRepo`) AND the MinIO HEAD on every Range request — the
    // common path during video playback fires dozens of these per session.
    //
    // Stream-token auth is already bound to (attachment_id, user_id) and
    // verified for signature + expiry, so a cache hit on the token path
    // skips the membership re-check too. Bearer auth still re-runs the
    // membership lookup since the JWT is global and could outlive a
    // channel-leave / DM-block.
    let cache = meta_cache();
    let (s3_key, content_type, total) = match cache.get(&attachment_id) {
        Some(meta) if matches!(auth, AuthSource::StreamToken(_)) => {
            (meta.s3_key.clone(), meta.content_type.clone(), meta.total)
        }
        _ => {
            let user_id = auth.user_id();
            let (s3_key, content_type, _filename) =
                match find_channel_attachment(&state, user_id, attachment_id).await {
                    Ok(info) => info,
                    Err(_) => find_dm_attachment(&state, user_id, attachment_id).await?,
                };
            // Re-use cached size if present (auth was Bearer and the
            // record predates this request); otherwise HEAD MinIO once.
            // Extract `total` as a Copy `u64` so the read-guard from
            // `cache.get` doesn't outlive its expression — the awaited
            // `head_object_meta` below would otherwise hold a lock under
            // edition-2024 drop semantics (`if_let_rescope`).
            let cached_total = cache.get(&attachment_id).map(|m| m.total);
            let total = if let Some(t) = cached_total {
                t
            } else {
                let (t, _) = state.storage.head_object_meta(&s3_key).await.map_err(|e| {
                    if e == "not_found" {
                        AppError(jolkr_common::JolkrError::NotFound)
                    } else {
                        AppError(jolkr_common::JolkrError::Internal(format!("Storage head: {e}")))
                    }
                })?;
                t
            };
            cache.insert(
                attachment_id,
                AttachmentMeta {
                    total,
                    s3_key: s3_key.clone(),
                    content_type: content_type.clone(),
                },
            );
            (s3_key, content_type, total)
        }
    };

    let safe_ct = safe_inline_content_type(&content_type);

    let range_header = parts.headers.get(header::RANGE).and_then(|v| v.to_str().ok());
    if let Some((req_start, req_end)) = range_header.and_then(parse_range_header) {
        let end_actual = req_end
            .unwrap_or(total.saturating_sub(1))
            .min(total.saturating_sub(1))
            .min(req_start.saturating_add(RANGE_CHUNK_CAP).saturating_sub(1));

        if total == 0 || req_start > end_actual {
            return Ok((
                StatusCode::RANGE_NOT_SATISFIABLE,
                [(header::CONTENT_RANGE, format!("bytes */{}", total))],
            )
                .into_response());
        }

        let bytes = state
            .storage
            .get_object_range(&s3_key, req_start, Some(end_actual))
            .await
            .map_err(|e| AppError(jolkr_common::JolkrError::Internal(format!("Storage range: {e}"))))?;

        let length = bytes.len() as u64;
        return Ok((
            StatusCode::PARTIAL_CONTENT,
            range_headers(safe_ct, length, req_start, end_actual, total),
            bytes,
        )
            .into_response());
    }

    // No Range header → full body. Used by image blob fetches and HEAD
    // probes; video/audio elements always send Range so they never hit
    // this branch and we never buffer the whole 250 MB file here.
    let (data, _ct) = state.storage.get_object(&s3_key).await.map_err(|e| {
        if e == "not_found" {
            AppError(jolkr_common::JolkrError::NotFound)
        } else {
            AppError(jolkr_common::JolkrError::Internal(format!("Storage get: {e}")))
        }
    })?;
    Ok((StatusCode::OK, full_headers(safe_ct, data.len() as u64), data).into_response())
}

/// Response payload for GET /api/files/:attachment_id/url.
#[derive(Serialize)]
pub(crate) struct StreamUrlResponse {
    /// Short-lived signed URL pointing back at `/api/files/:id?t=<token>`.
    pub url: String,
}

/// GET /api/files/:attachment_id/url
///
/// Issues a short-lived (`STREAM_TOKEN_TTL_SECS`) signed URL pointing back
/// at our own bytes endpoint with the token in the query string. The URL
/// stays inside the `/api/files/...` namespace — MinIO is never exposed to
/// the browser, and there's no presigned-URL encoding bug to dance around.
pub(crate) async fn get_file_url(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(attachment_id): Path<Uuid>,
) -> Result<Json<StreamUrlResponse>, AppError> {
    // Verify access (so we don't sign tokens for files the user can't read).
    match find_channel_attachment(&state, auth.user_id, attachment_id).await {
        Ok(_) => {}
        Err(_) => {
            find_dm_attachment(&state, auth.user_id, attachment_id).await?;
        }
    }

    let token = stream_token::sign(
        &state.jwt_secret,
        attachment_id,
        auth.user_id,
        stream_token::STREAM_TOKEN_TTL_SECS,
    )
    .map_err(|e| AppError(jolkr_common::JolkrError::Internal(format!("token sign: {e}"))))?;

    Ok(Json(StreamUrlResponse {
        url: format!("/api/files/{attachment_id}?t={token}"),
    }))
}

// ─── auth helpers ────────────────────────────────────────────────────────

/// Which credential the caller used. The variant matters because stream
/// tokens are scoped (attachment_id + user_id baked in, signature verified)
/// — we can trust them on cache hits to skip the membership re-check.
/// Bearer tokens are unscoped JWTs that outlive channel/DM membership
/// changes, so they always re-run the access query.
enum AuthSource {
    Bearer(Uuid),
    StreamToken(Uuid),
}

impl AuthSource {
    fn user_id(&self) -> Uuid {
        match self {
            Self::Bearer(id) | Self::StreamToken(id) => *id,
        }
    }
}

/// Resolve the calling user from EITHER `Authorization: Bearer ...` OR
/// `?t=<stream-token>`. Stream tokens are bound to the attachment they were
/// issued for — verifying that here means a leaked token can never be used
/// to read another file.
fn resolve_user(
    state: &AppState,
    parts: &Parts,
    attachment_id: Uuid,
    stream_token_param: Option<&str>,
) -> Result<AuthSource, AppError> {
    if let Some(bearer) = parts
        .headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
    {
        let claims = jolkr_core::AuthService::validate_token(&state.jwt_secret, bearer)
            .map_err(|e| AppError(jolkr_common::JolkrError::Jwt(format!("Invalid token: {e}"))))?;
        return Ok(AuthSource::Bearer(claims.sub));
    }

    if let Some(token) = stream_token_param {
        let user_id = stream_token::verify(&state.jwt_secret, token, attachment_id)
            .map_err(|e| AppError(jolkr_common::JolkrError::Jwt(format!("Invalid stream token: {e}"))))?;
        return Ok(AuthSource::StreamToken(user_id));
    }

    Err(AppError(jolkr_common::JolkrError::Unauthorized))
}

// ─── DB lookups (unchanged from previous revision) ───────────────────────

async fn find_channel_attachment(
    state: &AppState,
    user_id: Uuid,
    attachment_id: Uuid,
) -> Result<(String, String, String), AppError> {
    let att = jolkr_db::repo::AttachmentRepo::get_by_id(&state.pool, attachment_id).await?;
    let msg = jolkr_db::repo::MessageRepo::get_by_id(&state.pool, att.message_id).await?;
    let channel = jolkr_db::repo::ChannelRepo::get_by_id(&state.pool, msg.channel_id).await?;

    jolkr_db::repo::MemberRepo::get_member(&state.pool, channel.server_id, user_id)
        .await
        .map_err(|e| {
            tracing::warn!(?e, "channel attachment access: caller is not a member of channel's server → 403");
            AppError(jolkr_common::JolkrError::Forbidden)
        })?;

    Ok((att.url, att.content_type, att.filename))
}

async fn find_dm_attachment(
    state: &AppState,
    user_id: Uuid,
    attachment_id: Uuid,
) -> Result<(String, String, String), AppError> {
    let att = sqlx::query_as::<_, jolkr_db::models::DmAttachmentRow>(
        "SELECT * FROM dm_attachments WHERE id = $1",
    )
    .bind(attachment_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| AppError(jolkr_common::JolkrError::Internal(e.to_string())))?
    .ok_or(AppError(jolkr_common::JolkrError::NotFound))?;

    let msg = jolkr_db::repo::DmRepo::get_message(&state.pool, att.dm_message_id).await?;

    if !jolkr_db::repo::DmRepo::is_member(&state.pool, msg.dm_channel_id, user_id).await? {
        return Err(AppError(jolkr_common::JolkrError::Forbidden));
    }

    Ok((att.url, att.content_type, att.filename))
}

// ─── header / range helpers ──────────────────────────────────────────────

/// Parse a `bytes=START-END` Range header. Returns `None` for any unit
/// other than `bytes` or for malformed input — the caller falls back to
/// the full-body branch in that case.
fn parse_range_header(value: &str) -> Option<(u64, Option<u64>)> {
    let s = value.trim().strip_prefix("bytes=")?;
    let first = s.split(',').next()?;
    let (start_str, end_str) = first.split_once('-')?;
    if start_str.is_empty() {
        // Suffix range like `bytes=-500` — uncommon for media playback,
        // skip and let the client retry with an absolute range.
        return None;
    }
    let start = start_str.parse::<u64>().ok()?;
    let end = if end_str.is_empty() {
        None
    } else {
        Some(end_str.parse::<u64>().ok()?)
    };
    Some((start, end))
}

fn range_headers(content_type: String, length: u64, start: u64, end: u64, total: u64) -> HeaderMap {
    let mut h = HeaderMap::with_capacity(6);
    insert_str(&mut h, header::CONTENT_TYPE, &content_type);
    insert_str(&mut h, header::CONTENT_LENGTH, &length.to_string());
    insert_str(&mut h, header::CONTENT_RANGE, &format!("bytes {start}-{end}/{total}"));
    insert_str(&mut h, header::ACCEPT_RANGES, "bytes");
    insert_str(&mut h, header::CACHE_CONTROL, "private, max-age=86400");
    insert_str(&mut h, header::X_CONTENT_TYPE_OPTIONS, "nosniff");
    h
}

fn full_headers(content_type: String, length: u64) -> HeaderMap {
    let mut h = HeaderMap::with_capacity(5);
    insert_str(&mut h, header::CONTENT_TYPE, &content_type);
    insert_str(&mut h, header::CONTENT_LENGTH, &length.to_string());
    insert_str(&mut h, header::ACCEPT_RANGES, "bytes");
    insert_str(&mut h, header::CACHE_CONTROL, "private, max-age=86400");
    insert_str(&mut h, header::X_CONTENT_TYPE_OPTIONS, "nosniff");
    h
}

fn insert_str(map: &mut HeaderMap, name: HeaderName, value: &str) {
    if let Ok(v) = HeaderValue::from_str(value) {
        map.insert(name, v);
    }
}

/// Pick a content-type that is safe to render inline. SVGs and script-able
/// types are forced to `application/octet-stream` so the browser can't
/// execute them as part of the same origin.
fn safe_inline_content_type(content_type: &str) -> String {
    let ct_lower = content_type.to_ascii_lowercase();
    if ct_lower == "image/svg+xml"
        || ct_lower.starts_with("text/html")
        || ct_lower.starts_with("application/xhtml")
        || ct_lower.starts_with("application/javascript")
        || ct_lower.starts_with("text/javascript")
    {
        return "application/octet-stream".to_string();
    }
    content_type.to_string()
}
