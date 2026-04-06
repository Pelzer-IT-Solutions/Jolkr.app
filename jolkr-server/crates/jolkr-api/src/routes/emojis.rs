use axum::{
    extract::{Multipart, Path, State},
    Json,
};
use serde::Serialize;
use uuid::Uuid;

use jolkr_core::EmojiService;
use crate::routes::attachments::PRESIGN_EXPIRY_SECS;
use jolkr_core::services::emoji::EmojiInfo;

use crate::errors::AppError;
use crate::middleware::AuthUser;
use crate::routes::AppState;
use crate::storage::MAX_FILE_SIZE;

// ── DTOs ───────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct EmojiResponse {
    pub emoji: EmojiInfo,
}

#[derive(Debug, Serialize)]
pub struct EmojisResponse {
    pub emojis: Vec<EmojiInfo>,
}

// ── Handlers ───────────────────────────────────────────────────────────

/// POST /api/servers/:server_id/emojis — upload custom emoji (multipart: name + file)
pub async fn upload_emoji(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(server_id): Path<Uuid>,
    mut multipart: Multipart,
) -> Result<Json<EmojiResponse>, AppError> {
    let mut name: Option<String> = None;
    let mut file_data: Option<Vec<u8>> = None;
    let mut file_name: Option<String> = None;
    let mut content_type: Option<String> = None;

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|_| AppError(jolkr_common::JolkrError::Validation("Invalid multipart data".into())))?
    {
        let field_name = field.name().unwrap_or("").to_string();
        match field_name.as_str() {
            "name" => {
                name = Some(
                    field
                        .text()
                        .await
                        .map_err(|_| AppError(jolkr_common::JolkrError::Validation("Invalid name field".into())))?,
                );
            }
            "file" => {
                file_name = field.file_name().map(|s| s.to_string());
                content_type = field.content_type().map(|s| s.to_string());
                file_data = Some(
                    field
                        .bytes()
                        .await
                        .map_err(|_| AppError(jolkr_common::JolkrError::Validation("Failed to read file".into())))?
                        .to_vec(),
                );
            }
            _ => {}
        }
    }

    let name = name.ok_or_else(|| AppError(jolkr_common::JolkrError::Validation("Missing 'name' field".into())))?;
    let file_data = file_data.ok_or_else(|| AppError(jolkr_common::JolkrError::Validation("Missing 'file' field".into())))?;
    let file_name = file_name.unwrap_or_else(|| "emoji.png".to_string());
    let content_type = content_type.unwrap_or_else(|| "image/png".to_string());

    // Validate file
    if file_data.is_empty() {
        return Err(AppError(jolkr_common::JolkrError::Validation("File is empty".into())));
    }
    if file_data.len() > MAX_FILE_SIZE {
        return Err(AppError(jolkr_common::JolkrError::Validation("File too large (max 25MB)".into())));
    }
    // Only allow images
    if !content_type.starts_with("image/") {
        return Err(AppError(jolkr_common::JolkrError::Validation("Only image files are allowed for emojis".into())));
    }
    // Validate magic bytes match the claimed content type
    let magic_ok = match content_type.as_str() {
        "image/png" => file_data.starts_with(&[0x89, 0x50, 0x4E, 0x47]),
        "image/jpeg" | "image/jpg" => file_data.starts_with(&[0xFF, 0xD8, 0xFF]),
        "image/gif" => file_data.starts_with(b"GIF87a") || file_data.starts_with(b"GIF89a"),
        "image/webp" => file_data.len() >= 12 && &file_data[..4] == b"RIFF" && &file_data[8..12] == b"WEBP",
        "image/svg+xml" => false, // SVG not allowed for emojis (XSS risk)
        _ => false,
    };
    if !magic_ok {
        return Err(AppError(jolkr_common::JolkrError::Validation("File content does not match the declared image type".into())));
    }

    let animated = content_type == "image/gif";

    // Upload to S3
    let file_id = Uuid::new_v4();
    let image_key = state
        .storage
        .upload("emojis", file_id, &file_name, &content_type, &file_data)
        .await
        .map_err(|e| AppError(jolkr_common::JolkrError::Internal(e)))?;

    // Create DB record
    let row = EmojiService::create_emoji(
        &state.pool,
        server_id,
        auth.user_id,
        &name,
        &image_key,
        animated,
    )
    .await
    .map_err(|e| {
        // Clean up uploaded file on DB error
        let storage = state.storage.clone();
        let key = image_key.clone();
        tokio::spawn(async move { let _ = storage.delete(&key).await; });
        AppError(e)
    })?;

    // Presign the URL for the response
    let image_url = state
        .storage
        .presign_get(&row.image_key, PRESIGN_EXPIRY_SECS)
        .await
        .unwrap_or_default();

    Ok(Json(EmojiResponse {
        emoji: EmojiInfo::from_row(row, image_url),
    }))
}

/// GET /api/servers/:server_id/emojis — list all custom emojis
pub async fn list_emojis(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(server_id): Path<Uuid>,
) -> Result<Json<EmojisResponse>, AppError> {
    let rows = EmojiService::list_emojis(&state.pool, server_id, auth.user_id).await?;

    let mut emojis = Vec::with_capacity(rows.len());
    for row in rows {
        let image_url = state
            .storage
            .presign_get(&row.image_key, PRESIGN_EXPIRY_SECS)
            .await
            .unwrap_or_default();
        emojis.push(EmojiInfo::from_row(row, image_url));
    }

    Ok(Json(EmojisResponse { emojis }))
}

/// DELETE /api/emojis/:emoji_id — delete a custom emoji
pub async fn delete_emoji(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(emoji_id): Path<Uuid>,
) -> Result<axum::http::StatusCode, AppError> {
    let image_key = EmojiService::delete_emoji(&state.pool, emoji_id, auth.user_id).await?;

    // Clean up S3 object
    let storage = state.storage.clone();
    tokio::spawn(async move { let _ = storage.delete(&image_key).await; });

    Ok(axum::http::StatusCode::NO_CONTENT)
}
