use chrono::Utc;
use sqlx::PgPool;
use uuid::Uuid;

use crate::models::CategoryRow;
use jolkr_common::JolkrError;

/// Repository for `category` persistence.
pub struct CategoryRepo;

impl CategoryRepo {
    /// Create a new category within a server.
    pub async fn create(
        pool: &PgPool,
        id: Uuid,
        server_id: Uuid,
        name: &str,
        position: i32,
    ) -> Result<CategoryRow, JolkrError> {
        let now = Utc::now();
        let row = sqlx::query_as::<_, CategoryRow>(
            "
            INSERT INTO categories (id, server_id, name, position, created_at)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *
            ",
        )
        .bind(id)
        .bind(server_id)
        .bind(name)
        .bind(position)
        .bind(now)
        .fetch_one(pool)
        .await?;

        Ok(row)
    }

    /// Get a category by ID.
    pub async fn get_by_id(pool: &PgPool, id: Uuid) -> Result<CategoryRow, JolkrError> {
        let row = sqlx::query_as::<_, CategoryRow>(
            "SELECT * FROM categories WHERE id = $1",
        )
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or(JolkrError::NotFound)?;

        Ok(row)
    }

    /// List all categories for a server, ordered by position.
    pub async fn list_for_server(
        pool: &PgPool,
        server_id: Uuid,
    ) -> Result<Vec<CategoryRow>, JolkrError> {
        let rows = sqlx::query_as::<_, CategoryRow>(
            "
            SELECT * FROM categories
            WHERE server_id = $1
            ORDER BY position ASC
            ",
        )
        .bind(server_id)
        .fetch_all(pool)
        .await?;

        Ok(rows)
    }

    /// Bulk update category positions in a single transaction.
    pub async fn bulk_update_positions(
        pool: &PgPool,
        positions: &[(Uuid, i32)],
    ) -> Result<(), JolkrError> {
        let mut tx = pool.begin().await?;
        for (category_id, position) in positions {
            sqlx::query(
                "
                UPDATE categories
                SET position = $2
                WHERE id = $1
                ",
            )
            .bind(category_id)
            .bind(position)
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;
        Ok(())
    }

    /// Update a category's name and/or position.
    pub async fn update(
        pool: &PgPool,
        id: Uuid,
        name: Option<&str>,
        position: Option<i32>,
    ) -> Result<CategoryRow, JolkrError> {
        let row = sqlx::query_as::<_, CategoryRow>(
            "
            UPDATE categories
            SET name     = COALESCE($2, name),
                position = COALESCE($3, position)
            WHERE id = $1
            RETURNING *
            ",
        )
        .bind(id)
        .bind(name)
        .bind(position)
        .fetch_optional(pool)
        .await?
        .ok_or(JolkrError::NotFound)?;

        Ok(row)
    }

    /// Delete a category. Channels in this category get `category_id` set to NULL.
    /// Uses a transaction to ensure atomicity.
    pub async fn delete(pool: &PgPool, id: Uuid) -> Result<(), JolkrError> {
        let mut tx = pool.begin().await?;

        // Unlink channels first
        sqlx::query("UPDATE channels SET category_id = NULL WHERE category_id = $1")
            .bind(id)
            .execute(&mut *tx)
            .await?;

        let result = sqlx::query("DELETE FROM categories WHERE id = $1")
            .bind(id)
            .execute(&mut *tx)
            .await?;

        if result.rows_affected() == 0 {
            tx.rollback().await?;
            return Err(JolkrError::NotFound);
        }

        tx.commit().await?;
        Ok(())
    }
}
