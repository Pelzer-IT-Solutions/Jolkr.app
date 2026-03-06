use axum::{
    extract::{Multipart, Path, State},
    Json,
};
use serde::Serialize;
use uuid::Uuid;

use jolkr_common::Permissions;
use jolkr_core::services::message::MessageService;
use jolkr_db::repo::{AttachmentRepo, ChannelRepo, MemberRepo, MessageRepo, RoleRepo};

use crate::errors::AppError;
use crate::middleware::AuthUser;
use crate::routes::AppState;
use crate::storage::MAX_FILE_SIZE;

/// Strip path separators, null bytes, and directory traversal from filenames.
///
/// Extracts the basename (last component after any path separator), removes
/// null bytes, and collapses `..` sequences to prevent path traversal.
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

    let content_type = field
        .content_type()
        .unwrap_or("application/octet-stream")
        .to_string();

    let data = field
        .bytes()
        .await
        .map_err(|e| AppError(jolkr_common::JolkrError::Validation(e.to_string())))?;

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
        .presign_get(&object_key, 7 * 24 * 3600)
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
            if let Ok(url) = state.storage.presign_get(&att.url, 7 * 24 * 3600).await {
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
            .presign_get(&row.url, 7 * 24 * 3600)
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

/// POST /api/upload
///
/// General-purpose file upload (for avatars, server icons, etc.)
/// Returns the object key and a presigned download URL.
pub async fn upload_file(
    State(state): State<AppState>,
    _auth: AuthUser,
    mut multipart: Multipart,
) -> Result<Json<serde_json::Value>, AppError> {
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

    let file_id = Uuid::new_v4();
    let object_key = state
        .storage
        .upload("uploads", file_id, &filename, &content_type, &data)
        .await
        .map_err(|e| {
            AppError(jolkr_common::JolkrError::Internal(format!(
                "Storage upload failed: {e}"
            )))
        })?;

    let download_url = state
        .storage
        .presign_get(&object_key, 7 * 24 * 3600)
        .await
        .map_err(|e| {
            AppError(jolkr_common::JolkrError::Internal(format!(
                "Failed to generate download URL: {e}"
            )))
        })?;

    Ok(Json(serde_json::json!({
        "key": object_key,
        "url": download_url,
        "filename": filename,
        "content_type": content_type,
        "size_bytes": data.len(),
    })))
}
