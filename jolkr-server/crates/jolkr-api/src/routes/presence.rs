use axum::{
    extract::State,
    Json,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::errors::AppError;
use crate::middleware::AuthUser;
use crate::routes::AppState;

#[derive(Debug, Serialize)]
pub(crate) struct PresenceEntry {
    pub user_id: Uuid,
    pub status: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct PresenceResponse {
    pub presences: Vec<PresenceEntry>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct PresenceQuery {
    pub user_ids: Vec<Uuid>,
}

/// POST /api/presence/query — get presence for a list of user IDs.
pub(crate) async fn query_presence(
    State(state): State<AppState>,
    _auth: AuthUser,
    Json(body): Json<PresenceQuery>,
) -> Result<Json<PresenceResponse>, AppError> {
    if body.user_ids.len() > 100 {
        return Err(AppError(jolkr_common::JolkrError::Validation(
            "Cannot query more than 100 users at once".into(),
        )));
    }

    let results = state.redis.get_presences(&body.user_ids).await;
    let presences = results
        .into_iter()
        .map(|(user_id, status)| PresenceEntry {
            user_id,
            // Map "invisible" to "offline" to prevent leaking invisible status
            status: if status == "invisible" { "offline".to_string() } else { status },
        })
        .collect();

    Ok(Json(PresenceResponse { presences }))
}
