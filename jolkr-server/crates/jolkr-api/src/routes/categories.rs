use axum::{
    extract::{Path, State},
    Json,
};
use serde::Serialize;
use uuid::Uuid;

use jolkr_core::CategoryService;
use jolkr_core::services::category::{CategoryInfo, CreateCategoryRequest, UpdateCategoryRequest};
use jolkr_db::repo::{CategoryRepo, MemberRepo};

use crate::errors::AppError;
use crate::middleware::AuthUser;
use crate::routes::AppState;

// ── DTOs ───────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub(crate) struct CategoryResponse {
    pub category: CategoryInfo,
}

#[derive(Debug, Serialize)]
pub(crate) struct CategoriesResponse {
    pub categories: Vec<CategoryInfo>,
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
        .map_err(|_| AppError(jolkr_common::JolkrError::Forbidden))?;
    let categories = CategoryService::list_categories(&state.pool, server_id).await?;
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
