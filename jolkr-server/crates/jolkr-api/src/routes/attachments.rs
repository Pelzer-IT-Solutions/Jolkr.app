use axum::{
    extract::{Multipart, Path, Query, State},
    Json,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use jolkr_common::Permissions;
use jolkr_core::services::message::MessageService;
use jolkr_db::repo::{AttachmentRepo, ChannelRepo, MemberRepo, MessageRepo, RoleRepo};

use crate::errors::AppError;
use crate::image_processing::ImagePurpose;
use crate::middleware::AuthUser;
use crate::routes::AppState;
use crate::storage::MAX_FILE_SIZE;

/// Strip path separators, null bytes, and directory traversal from filenames.
///
/// Extracts the basename (last component after any path separator), removes
/// null bytes, and collapses `..` sequences to prevent path traversal.
/// Allowed MIME types for file uploads. Blocks dangerous types like text/html
/// and application/javascript while allowing common media and document types.
const ALLOWED_MIME_TYPES: &[&str] = &[
    "image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml",
    "image/bmp", "image/tiff", "image/avif",
    "video/mp4", "video/webm", "video/ogg", "video/quicktime",
    "audio/mpeg", "audio/ogg", "audio/wav", "audio/webm", "audio/aac", "audio/flac",
    "application/pdf", "text/plain",
    "application/octet-stream", // fallback for unknown types
];

/// Presigned URL lifetime in seconds (4 hours).
pub const PRESIGN_EXPIRY_SECS: u32 = 4 * 3600;

pub fn is_allowed_content_type(ct: &str) -> bool {
    ALLOWED_MIME_TYPES.iter().any(|allowed| ct.eq_ignore_ascii_case(allowed))
}

/// Validate that actual file bytes match the claimed MIME type via magic bytes.
/// Returns the effective content type to use for storage.
fn validate_content_type(claimed: &str, data: &[u8]) -> Result<String, AppError> {
    // SVG is XML-based and can contain scripts — block it
    if claimed.eq_ignore_ascii_case("image/svg+xml") {
        let prefix = std::str::from_utf8(&data[..data.len().min(4096)]).unwrap_or("");
        let lower = prefix.to_lowercase();
        if lower.contains("<script") || lower.contains("javascript:") || lower.contains("on") {
            return Err(AppError(jolkr_common::JolkrError::Validation(
                "SVG files with embedded scripts are not allowed".into(),
            )));
        }
    }

    // For binary formats, verify magic bytes match the claimed type
    let dominated = match &data[..data.len().min(12)] {
        // JPEG: FF D8 FF
        d if d.len() >= 3 && d[0] == 0xFF && d[1] == 0xD8 && d[2] == 0xFF => Some("image/jpeg"),
        // PNG: 89 50 4E 47
        d if d.len() >= 4 && d[..4] == [0x89, 0x50, 0x4E, 0x47] => Some("image/png"),
        // GIF: GIF87a or GIF89a
        d if d.len() >= 4 && &d[..3] == b"GIF" => Some("image/gif"),
        // WebP: RIFF....WEBP
        d if d.len() >= 12 && &d[..4] == b"RIFF" && &d[8..12] == b"WEBP" => Some("image/webp"),
        // PDF: %PDF
        d if d.len() >= 4 && &d[..4] == b"%PDF" => Some("application/pdf"),
        // MP4/MOV: ftyp at offset 4
        d if d.len() >= 8 && &d[4..8] == b"ftyp" => Some("video/mp4"),
        // OGG: OggS
        d if d.len() >= 4 && &d[..4] == b"OggS" => Some("audio/ogg"),
        // WAV: RIFF....WAVE
        d if d.len() >= 12 && &d[..4] == b"RIFF" && &d[8..12] == b"WAVE" => Some("audio/wav"),
        // FLAC: fLaC
        d if d.len() >= 4 && &d[..4] == b"fLaC" => Some("audio/flac"),
        // WebM: 1A 45 DF A3 (EBML header, used by both WebM and MKV)
        d if d.len() >= 4 && d[..4] == [0x1A, 0x45, 0xDF, 0xA3] => Some("video/webm"),
        _ => None,
    };

    // If we detected a type from magic bytes, use it (more trustworthy than client header).
    // If not detected (text/plain, octet-stream, audio/mpeg etc.), trust the claimed type
    // since it already passed the allowlist check.
    Ok(dominated.unwrap_or(claimed).to_string())
}

pub fn sanitize_filename(raw: &str) -> String {
    // Take only the final path component (basename) BEFORE stripping separators,
    // so that "../../etc/passwd" becomes "passwd".
    let name = raw.rsplit('/').next().unwrap_or(raw);
    let name = name.rsplit('\\').next().unwrap_or(name);

    // Strip null bytes and remaining path separators
    let name: String = name
        .replace('\0', "")
        .replace('/', "")
        .replace('\\', "");

    // Replace ".." sequences to prevent directory traversal
    let name = name.replace("..", "");
    let name = name.trim();

    if name.is_empty() { "upload".to_string() } else { name.to_string() }
}

// ── DTOs ───────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct AttachmentInfo {
    pub id: Uuid,
    pub message_id: Uuid,
    pub filename: String,
    pub content_type: String,
    pub size_bytes: i64,
    pub url: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Serialize)]
pub struct UploadResponse {
    pub attachment: AttachmentInfo,
}

#[derive(Debug, Serialize)]
pub struct AttachmentsResponse {
    pub attachments: Vec<AttachmentInfo>,
}

// ── Handlers ───────────────────────────────────────────────────────────

/// POST /api/channels/:channel_id/messages/:message_id/attachments
///
/// Multipart upload: expects a single `file` field.
pub async fn upload_attachment(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((channel_id, message_id)): Path<(Uuid, Uuid)>,
    mut multipart: Multipart,
) -> Result<Json<UploadResponse>, AppError> {
    // Verify the channel exists and user is a member
    let channel = ChannelRepo::get_by_id(&state.pool, channel_id).await?;
    let member = MemberRepo::get_member(&state.pool, channel.server_id, auth.user_id)
        .await
        .map_err(|_| AppError(jolkr_common::JolkrError::Forbidden))?;
    // Check ATTACH_FILES permission (owner bypasses)
    let server = jolkr_db::repo::ServerRepo::get_by_id(&state.pool, channel.server_id).await?;
    if server.owner_id != auth.user_id {
        let ch_perms = RoleRepo::compute_channel_permissions(
            &state.pool, channel.server_id, channel_id, member.id,
        ).await?;
        if !Permissions::from(ch_perms).has(Permissions::ATTACH_FILES) {
            return Err(AppError(jolkr_common::JolkrError::Forbidden));
        }
    }

    // Verify the message exists and belongs to this channel
    let msg = MessageRepo::get_by_id(&state.pool, message_id).await?;
    if msg.channel_id != channel_id {
        return Err(AppError(jolkr_common::JolkrError::NotFound));
    }
    // Only the message author can attach files
    if msg.author_id != auth.user_id {
        return Err(AppError(jolkr_common::JolkrError::Forbidden));
    }

    // Read the multipart file field
    let field = multipart
        .next_field()
        .await
        .map_err(|e| AppError(jolkr_common::JolkrError::Validation(e.to_string())))?
        .ok_or_else(|| {
            AppError(jolkr_common::JolkrError::Validation(
                "No file field in multipart body".into(),
            ))
        })?;

    let filename = sanitize_filename(
        field.file_name().unwrap_or("upload"),
    );

    let claimed_type = field
        .content_type()
        .unwrap_or("application/octet-stream")
        .to_string();

    if !is_allowed_content_type(&claimed_type) {
        return Err(AppError(jolkr_common::JolkrError::Validation(
            format!("File type '{}' is not allowed", claimed_type),
        )));
    }

    let data = field
        .bytes()
        .await
        .map_err(|e| AppError(jolkr_common::JolkrError::Validation(e.to_string())))?;

    // Verify actual file content matches claimed type via magic bytes
    let content_type = validate_content_type(&claimed_type, &data)?;

    // Validate file size
    if data.len() > MAX_FILE_SIZE {
        return Err(AppError(jolkr_common::JolkrError::Validation(
            format!("File too large. Maximum size is {} MB", MAX_FILE_SIZE / 1024 / 1024),
        )));
    }

    if data.is_empty() {
        return Err(AppError(jolkr_common::JolkrError::Validation(
            "File is empty".into(),
        )));
    }

    // Upload to S3
    let attachment_id = Uuid::new_v4();
    let object_key = state
        .storage
        .upload("attachments", attachment_id, &filename, &content_type, &data)
        .await
        .map_err(|e| {
            AppError(jolkr_common::JolkrError::Internal(format!(
                "Storage upload failed: {e}"
            )))
        })?;

    // Generate a presigned download URL (valid for 7 days)
    let download_url = state
        .storage
        .presign_get(&object_key, PRESIGN_EXPIRY_SECS)
        .await
        .map_err(|e| {
            AppError(jolkr_common::JolkrError::Internal(format!(
                "Failed to generate download URL: {e}"
            )))
        })?;

    // Save metadata to DB
    let row = AttachmentRepo::create(
        &state.pool,
        attachment_id,
        message_id,
        &filename,
        &content_type,
        data.len() as i64,
        &object_key,
        None,
    )
    .await?;

    // Broadcast MessageUpdate so other clients see the new attachment
    if let Ok(mut enriched) = MessageService::get_message_by_id(&state.pool, message_id).await {
        for att in &mut enriched.attachments {
            if let Ok(url) = state.storage.presign_get(&att.url, PRESIGN_EXPIRY_SECS).await {
                att.url = url;
            }
        }
        let event = crate::ws::events::GatewayEvent::MessageUpdate { message: enriched };
        state.nats.publish_to_channel(channel_id, &event).await;
    }

    Ok(Json(UploadResponse {
        attachment: AttachmentInfo {
            id: row.id,
            message_id: row.message_id,
            filename: row.filename,
            content_type: row.content_type,
            size_bytes: row.size_bytes,
            url: download_url,
            created_at: row.created_at,
        },
    }))
}

/// GET /api/messages/:message_id/attachments
pub async fn list_attachments(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(message_id): Path<Uuid>,
) -> Result<Json<AttachmentsResponse>, AppError> {
    // Verify the caller has access to the message's channel
    let msg = MessageRepo::get_by_id(&state.pool, message_id).await?;
    let channel = ChannelRepo::get_by_id(&state.pool, msg.channel_id).await?;
    let member = MemberRepo::get_member(&state.pool, channel.server_id, auth.user_id)
        .await
        .map_err(|_| AppError(jolkr_common::JolkrError::Forbidden))?;
    // H4: Check VIEW_CHANNELS permission (owner bypasses)
    let server = jolkr_db::repo::ServerRepo::get_by_id(&state.pool, channel.server_id).await?;
    if server.owner_id != auth.user_id {
        let ch_perms = RoleRepo::compute_channel_permissions(
            &state.pool, channel.server_id, msg.channel_id, member.id,
        ).await?;
        if !Permissions::from(ch_perms).has(Permissions::VIEW_CHANNELS) {
            return Err(AppError(jolkr_common::JolkrError::Forbidden));
        }
    }

    let rows = AttachmentRepo::list_for_message(&state.pool, message_id).await?;

    let mut attachments = Vec::with_capacity(rows.len());
    for row in rows {
        let url = state
            .storage
            .presign_get(&row.url, PRESIGN_EXPIRY_SECS)
            .await
            .unwrap_or_else(|_| row.url.clone());

        attachments.push(AttachmentInfo {
            id: row.id,
            message_id: row.message_id,
            filename: row.filename,
            content_type: row.content_type,
            size_bytes: row.size_bytes,
            url,
            created_at: row.created_at,
        });
    }

    Ok(Json(AttachmentsResponse { attachments }))
}

/// Query parameters for the upload endpoint.
#[derive(Debug, Deserialize)]
pub struct UploadQuery {
    /// When set to "avatar" or "icon", the image is converted to WebP and resized.
    pub purpose: Option<String>,
}

/// POST /api/upload
///
/// General-purpose file upload (for avatars, server icons, etc.)
/// Returns the object key and a presigned download URL.
///
/// Query params:
///   - `?purpose=avatar` — convert to 256×256 WebP
///   - `?purpose=icon`   — convert to 256×256 WebP
pub async fn upload_file(
    State(state): State<AppState>,
    _auth: AuthUser,
    Query(query): Query<UploadQuery>,
    mut multipart: Multipart,
) -> Result<Json<serde_json::Value>, AppError> {
    let purpose = query
        .purpose
        .as_deref()
        .and_then(ImagePurpose::from_str);

    let field = multipart
        .next_field()
        .await
        .map_err(|e| AppError(jolkr_common::JolkrError::Validation(e.to_string())))?
        .ok_or_else(|| {
            AppError(jolkr_common::JolkrError::Validation(
                "No file field in multipart body".into(),
            ))
        })?;

    let filename = sanitize_filename(
        field.file_name().unwrap_or("upload"),
    );

    let content_type = field
        .content_type()
        .unwrap_or("application/octet-stream")
        .to_string();

    if !is_allowed_content_type(&content_type) {
        return Err(AppError(jolkr_common::JolkrError::Validation(
            format!("File type '{}' is not allowed", content_type),
        )));
    }

    // When purpose is set, only image types are allowed
    if purpose.is_some() && !content_type.starts_with("image/") {
        return Err(AppError(jolkr_common::JolkrError::Validation(
            "Only image files are allowed for avatars and server icons".into(),
        )));
    }

    let data = field
        .bytes()
        .await
        .map_err(|e| AppError(jolkr_common::JolkrError::Validation(e.to_string())))?;

    if data.len() > MAX_FILE_SIZE {
        return Err(AppError(jolkr_common::JolkrError::Validation(
            format!("File too large. Maximum size is {} MB", MAX_FILE_SIZE / 1024 / 1024),
        )));
    }

    if data.is_empty() {
        return Err(AppError(jolkr_common::JolkrError::Validation(
            "File is empty".into(),
        )));
    }

    // If purpose is avatar/icon, convert to WebP; otherwise store as-is
    let (upload_data, upload_filename, upload_content_type) = if let Some(purpose) = purpose {
        let webp_data = crate::image_processing::convert_to_webp(&data, &content_type, purpose)
            .map_err(|e| {
                AppError(jolkr_common::JolkrError::Validation(format!(
                    "Image conversion failed: {e}"
                )))
            })?;
        // Replace extension with .webp
        let webp_filename = replace_extension(&filename, "webp");
        (webp_data, webp_filename, "image/webp".to_string())
    } else {
        (data.to_vec(), filename.clone(), content_type.clone())
    };

    let file_id = Uuid::new_v4();
    let object_key = state
        .storage
        .upload("uploads", file_id, &upload_filename, &upload_content_type, &upload_data)
        .await
        .map_err(|e| {
            AppError(jolkr_common::JolkrError::Internal(format!(
                "Storage upload failed: {e}"
            )))
        })?;

    let download_url = state
        .storage
        .presign_get(&object_key, PRESIGN_EXPIRY_SECS)
        .await
        .map_err(|e| {
            AppError(jolkr_common::JolkrError::Internal(format!(
                "Failed to generate download URL: {e}"
            )))
        })?;

    Ok(Json(serde_json::json!({
        "key": object_key,
        "url": download_url,
        "filename": upload_filename,
        "content_type": upload_content_type,
        "size_bytes": upload_data.len(),
    })))
}

/// Replace the file extension, preserving the stem.
fn replace_extension(filename: &str, new_ext: &str) -> String {
    match filename.rsplit_once('.') {
        Some((stem, _)) => format!("{stem}.{new_ext}"),
        None => format!("{filename}.{new_ext}"),
    }
}
