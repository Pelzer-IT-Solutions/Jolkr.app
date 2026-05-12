use axum::{
    extract::{Multipart, Path, State},
    Json,
};
use serde::Serialize;
use uuid::Uuid;

use jolkr_core::DmService;
use jolkr_core::services::dm::DmMessageInfo;
use jolkr_core::services::message::AttachmentInfo;
use jolkr_db::repo::DmRepo;

use crate::errors::AppError;
use crate::middleware::auth::AuthUser;
use crate::routes::AppState;
use crate::storage::MAX_FILE_SIZE;

use super::types::dm_to_message_info;

/// Response body for POST /api/dms/:dm_id/messages/:message_id/attachments.
#[derive(Serialize)]
pub(crate) struct DmAttachmentResponse {
    pub attachment: AttachmentInfo,
}

/// Response body for GET /api/dms/:dm_id/attachments.
#[derive(Serialize)]
pub(crate) struct DmAttachmentsResponse {
    pub attachments: Vec<AttachmentInfo>,
}

/// GET /api/dms/:dm_id/attachments — list every attachment shared in this
/// DM newest-first, capped at 100 by default. Powers the "Shared Files"
/// side panel.
pub(crate) async fn list_dm_attachments(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(dm_id): Path<Uuid>,
) -> Result<Json<DmAttachmentsResponse>, AppError> {
    let attachments = DmService::list_attachments(&state.pool, dm_id, auth.user_id, None).await?;
    Ok(Json(DmAttachmentsResponse { attachments }))
}

/// POST /api/dms/:dm_id/messages/:message_id/attachments
pub(crate) async fn upload_dm_attachment(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((dm_id, message_id)): Path<(Uuid, Uuid)>,
    mut multipart: Multipart,
) -> Result<Json<DmAttachmentResponse>, AppError> {
    // Verify DM membership
    if !DmRepo::is_member(&state.pool, dm_id, auth.user_id).await? {
        return Err(AppError(jolkr_common::JolkrError::Forbidden));
    }

    // Verify message exists in this DM and belongs to the caller
    let msg = DmRepo::get_message(&state.pool, message_id).await?;
    if msg.dm_channel_id != dm_id {
        return Err(AppError(jolkr_common::JolkrError::NotFound));
    }
    if msg.author_id != auth.user_id {
        return Err(AppError(jolkr_common::JolkrError::Forbidden));
    }

    if let Some(field) = multipart.next_field().await.map_err(|e| {
        tracing::warn!(?e, "dm attachment upload: multipart next_field failed");
        AppError(jolkr_common::JolkrError::BadRequest("Invalid multipart".into()))
    })? {
        let filename = crate::routes::attachments::sanitize_filename(
            field.file_name().unwrap_or("file"),
        );
        let content_type = field
            .content_type()
            .unwrap_or("application/octet-stream")
            .to_string();

        if !crate::routes::attachments::is_allowed_content_type(&content_type) {
            return Err(AppError(jolkr_common::JolkrError::Validation(
                format!("File type '{}' is not allowed", content_type),
            )));
        }

        let data = field.bytes().await.map_err(|e| {
            tracing::warn!(?e, "dm attachment upload: reading file bytes failed");
            AppError(jolkr_common::JolkrError::BadRequest("Failed to read file".into()))
        })?;

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

        // Validate actual file bytes match claimed MIME type (same as channel attachments)
        let content_type = crate::routes::attachments::validate_content_type(&content_type, &data)?;

        let size_bytes = data.len() as i64;

        // Upload to S3
        let att_id = Uuid::new_v4();
        let key = state
            .storage
            .upload("dm-attachments", att_id, &filename, &content_type, &data)
            .await
            .map_err(|e| {
                AppError(jolkr_common::JolkrError::Internal(format!(
                    "Upload failed: {e}"
                )))
            })?;
        let row = DmRepo::create_attachment(
            &state.pool,
            att_id,
            message_id,
            &filename,
            &content_type,
            size_bytes,
            &key,
        )
        .await?;

        let proxy_url = jolkr_core::services::message::attachment_proxy_url(row.id);

        // Broadcast MessageUpdate so other clients see the new attachment
        if let Ok(row) = DmRepo::get_message(&state.pool, message_id).await {
            let mut dm_msg = DmMessageInfo::from(row);
            // Enrich with attachments
            let atts = DmRepo::list_attachments_for_messages(&state.pool, &[message_id])
                .await
                .unwrap_or_default();
            for att in atts {
                dm_msg.attachments.push(AttachmentInfo {
                    id: att.id,
                    filename: att.filename,
                    content_type: att.content_type,
                    size_bytes: att.size_bytes,
                    url: jolkr_core::services::message::attachment_proxy_url(att.id),
                });
            }
            // Enrich with reactions
            let reactions = DmRepo::list_reactions(&state.pool, message_id)
                .await
                .unwrap_or_default();
            {
                use std::collections::HashMap;
                let mut by_emoji: HashMap<String, (i64, Vec<Uuid>)> = HashMap::new();
                for r in reactions {
                    let entry = by_emoji.entry(r.emoji).or_insert((0, Vec::new()));
                    entry.0 += 1;
                    entry.1.push(r.user_id);
                }
                dm_msg.reactions = by_emoji
                    .into_iter()
                    .map(|(emoji, (count, user_ids))| {
                        jolkr_core::services::message::ReactionInfo {
                            emoji,
                            count,
                            user_ids,
                        }
                    })
                    .collect();
            }
            let event = crate::ws::events::GatewayEvent::MessageUpdate {
                message: dm_to_message_info(&dm_msg),
            };
            state.nats.publish_to_channel(dm_id, &event).await;
        }

        return Ok(Json(DmAttachmentResponse {
            attachment: AttachmentInfo {
                id: row.id,
                filename: row.filename,
                content_type: row.content_type,
                size_bytes: row.size_bytes,
                url: proxy_url,
            },
        }));
    }

    Err(AppError(jolkr_common::JolkrError::BadRequest(
        "No file in request".into(),
    )))
}
