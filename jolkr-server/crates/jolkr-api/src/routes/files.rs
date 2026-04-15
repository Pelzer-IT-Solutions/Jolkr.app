use axum::{
    extract::{Path, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
};
use uuid::Uuid;

use crate::errors::AppError;
use crate::middleware::auth::AuthUser;
use crate::routes::AppState;

/// Unified file-serving endpoint — looks up both channel and DM attachments,
/// verifies the caller has access, then streams the file from S3 with safe headers.
///
/// GET /api/files/:attachment_id
pub async fn serve_file(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(attachment_id): Path<Uuid>,
) -> Result<Response, AppError> {
    // Try channel attachments first, then DM attachments
    let (s3_key, content_type, filename) = match find_channel_attachment(&state, auth.user_id, attachment_id).await {
        Ok(info) => info,
        Err(_) => find_dm_attachment(&state, auth.user_id, attachment_id).await?,
    };

    // Fetch file bytes from S3
    let (data, _s3_ct) = state.storage.get_object(&s3_key).await.map_err(|e| {
        if e == "not_found" {
            AppError(jolkr_common::JolkrError::NotFound)
        } else {
            AppError(jolkr_common::JolkrError::Internal(format!("Storage error: {e}")))
        }
    })?;

    // Determine safe content type and disposition
    let (safe_ct, disposition) = safe_content_headers(&content_type, &filename);

    Ok((
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, safe_ct),
            (header::CONTENT_DISPOSITION, disposition),
            (header::CACHE_CONTROL, "private, max-age=86400".to_string()),
            // Prevent the browser from sniffing the content type
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff".to_string()),
        ],
        data,
    )
        .into_response())
}

/// Also serve upload files (avatars, icons via /api/upload with purpose).
/// GET /api/files/upload/:key
/// Not needed for now — avatars/icons go through /api/avatars/:user_id which already proxies.

/// Look up a channel attachment by ID and verify the caller has access to the channel.
async fn find_channel_attachment(
    state: &AppState,
    user_id: Uuid,
    attachment_id: Uuid,
) -> Result<(String, String, String), AppError> {
    let att = jolkr_db::repo::AttachmentRepo::get_by_id(&state.pool, attachment_id).await?;
    let msg = jolkr_db::repo::MessageRepo::get_by_id(&state.pool, att.message_id).await?;
    let channel = jolkr_db::repo::ChannelRepo::get_by_id(&state.pool, msg.channel_id).await?;

    // Verify membership
    jolkr_db::repo::MemberRepo::get_member(&state.pool, channel.server_id, user_id)
        .await
        .map_err(|_| AppError(jolkr_common::JolkrError::Forbidden))?;

    Ok((att.url, att.content_type, att.filename))
}

/// Look up a DM attachment by ID and verify the caller is a member of the DM.
async fn find_dm_attachment(
    state: &AppState,
    user_id: Uuid,
    attachment_id: Uuid,
) -> Result<(String, String, String), AppError> {
    // Query the DM attachment directly
    let att = sqlx::query_as::<_, jolkr_db::models::DmAttachmentRow>(
        "SELECT * FROM dm_attachments WHERE id = $1",
    )
    .bind(attachment_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| AppError(jolkr_common::JolkrError::Internal(e.to_string())))?
    .ok_or(AppError(jolkr_common::JolkrError::NotFound))?;

    // Get the DM message to find the DM channel
    let msg = jolkr_db::repo::DmRepo::get_message(&state.pool, att.dm_message_id).await?;

    // Verify DM membership
    if !jolkr_db::repo::DmRepo::is_member(&state.pool, msg.dm_channel_id, user_id).await? {
        return Err(AppError(jolkr_common::JolkrError::Forbidden));
    }

    Ok((att.url, att.content_type, att.filename))
}

/// Determine safe Content-Type and Content-Disposition for serving files.
/// SVGs and anything potentially executable → forced download.
/// Images/video/audio/PDF → inline (browser renders them safely).
fn safe_content_headers(content_type: &str, filename: &str) -> (String, String) {
    let ct_lower = content_type.to_ascii_lowercase();

    // SVG and script-capable types → force download with safe content type
    if ct_lower == "image/svg+xml"
        || ct_lower.starts_with("text/html")
        || ct_lower.starts_with("application/xhtml")
        || ct_lower.starts_with("application/javascript")
        || ct_lower.starts_with("text/javascript")
    {
        let safe_filename = sanitize_header_filename(filename);
        return (
            "application/octet-stream".to_string(),
            format!("attachment; filename=\"{safe_filename}\""),
        );
    }

    // Safe inline types: images, video, audio, PDF, plain text
    if ct_lower.starts_with("image/")
        || ct_lower.starts_with("video/")
        || ct_lower.starts_with("audio/")
        || ct_lower == "application/pdf"
        || ct_lower == "text/plain"
    {
        return (content_type.to_string(), "inline".to_string());
    }

    // Everything else → attachment (download)
    let safe_filename = sanitize_header_filename(filename);
    (
        content_type.to_string(),
        format!("attachment; filename=\"{safe_filename}\""),
    )
}

/// Sanitize a filename for use in Content-Disposition header.
fn sanitize_header_filename(name: &str) -> String {
    name.replace('"', "")
        .replace('\\', "")
        .replace('\r', "")
        .replace('\n', "")
}
