use axum::{
    extract::{Path, State},
    Json,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use jolkr_core::CategoryService;
use jolkr_core::services::category::{CategoryInfo, CreateCategoryRequest, UpdateCategoryRequest};
use jolkr_db::repo::{CategoryRepo, MemberRepo};

use crate::errors::AppError;
use crate::middleware::AuthUser;
use crate::routes::AppState;

// ── DTOs ───────────────────────────────────────────────────────────────

/// Response body for endpoints returning a single category (create/update).
#[derive(Debug, Serialize)]
pub(crate) struct CategoryResponse {
    pub category: CategoryInfo,
}

/// Response body for endpoints returning the full category list of a server.
#[derive(Debug, Serialize)]
pub(crate) struct CategoriesResponse {
    pub categories: Vec<CategoryInfo>,
}

/// Request body for PUT /api/servers/:server_id/categories/reorder.
#[derive(Debug, Deserialize)]
pub(crate) struct ReorderCategoriesRequest {
    pub category_positions: Vec<CategoryPositionEntry>,
}

/// New position for a single category in a reorder request.
#[derive(Debug, Deserialize)]
pub(crate) struct CategoryPositionEntry {
    pub id: Uuid,
    /// Zero-based sort index within the server's category list.
    pub position: i32,
}

// ── Handlers ───────────────────────────────────────────────────────────

/// POST /api/servers/:server_id/categories
pub(crate) async fn create_category(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(server_id): Path<Uuid>,
    Json(body): Json<CreateCategoryRequest>,
) -> Result<Json<CategoryResponse>, AppError> {
    let category =
        CategoryService::create_category(&state.pool, server_id, auth.user_id, body).await?;
    let event = crate::ws::events::GatewayEvent::CategoryCreate {
        category: category.clone(),
    };
    state.nats.publish_to_server(server_id, &event).await;
    Ok(Json(CategoryResponse { category }))
}

/// GET /api/servers/:server_id/categories — requires membership
pub(crate) async fn list_categories(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(server_id): Path<Uuid>,
) -> Result<Json<CategoriesResponse>, AppError> {
    MemberRepo::get_member(&state.pool, server_id, auth.user_id)
        .await
        .map_err(|e| {
            tracing::warn!(?e, "list categories: caller is not a server member → 403");
            AppError(jolkr_common::JolkrError::Forbidden)
        })?;
    let categories = CategoryService::list_categories(&state.pool, server_id).await?;
    Ok(Json(CategoriesResponse { categories }))
}

/// PUT /api/servers/:server_id/categories/reorder
pub(crate) async fn reorder_categories(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(server_id): Path<Uuid>,
    Json(body): Json<ReorderCategoriesRequest>,
) -> Result<Json<CategoriesResponse>, AppError> {
    let positions: Vec<(Uuid, i32)> = body
        .category_positions
        .iter()
        .map(|e| (e.id, e.position))
        .collect();

    let categories = CategoryService::reorder_categories(
        &state.pool,
        server_id,
        auth.user_id,
        &positions,
    )
    .await?;

    // Broadcast each category update to server members via WS so collaborators
    // see the new order without a manual refetch — same pattern as channel reorder.
    for category in &categories {
        let event = crate::ws::events::GatewayEvent::CategoryUpdate {
            category: category.clone(),
        };
        state.nats.publish_to_server(server_id, &event).await;
    }

    Ok(Json(CategoriesResponse { categories }))
}

/// PATCH /api/categories/:id
pub(crate) async fn update_category(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateCategoryRequest>,
) -> Result<Json<CategoryResponse>, AppError> {
    let category =
        CategoryService::update_category(&state.pool, id, auth.user_id, body).await?;
    let event = crate::ws::events::GatewayEvent::CategoryUpdate {
        category: category.clone(),
    };
    state.nats.publish_to_server(category.server_id, &event).await;
    Ok(Json(CategoryResponse { category }))
}

/// DELETE /api/categories/:id
pub(crate) async fn delete_category(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<axum::http::StatusCode, AppError> {
    let cat_row = CategoryRepo::get_by_id(&state.pool, id).await?;
    let server_id = cat_row.server_id;
    CategoryService::delete_category(&state.pool, id, auth.user_id).await?;
    let event = crate::ws::events::GatewayEvent::CategoryDelete {
        category_id: id,
        server_id,
    };
    state.nats.publish_to_server(server_id, &event).await;
    Ok(axum::http::StatusCode::NO_CONTENT)
}
