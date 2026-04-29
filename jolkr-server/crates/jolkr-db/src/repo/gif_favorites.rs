use sqlx::PgPool;
use uuid::Uuid;
use jolkr_common::JolkrError;

/// Database row for `giffavorite`.
#[derive(Debug, sqlx::FromRow, serde::Serialize)]
pub struct GifFavoriteRow {
    /// Unique identifier.
    pub id: Uuid,
    /// Owning user identifier.
    pub user_id: Uuid,
    /// Gif identifier.
    pub gif_id: String,
    /// Gif URL.
    pub gif_url: String,
    /// Preview image URL.
    pub preview_url: String,
    /// Title text.
    pub title: String,
    /// Added timestamp.
    pub added_at: chrono::DateTime<chrono::Utc>,
}

/// Repository for `giffavorites` persistence.
pub struct GifFavoritesRepo;

impl GifFavoritesRepo {
    /// Lists matching entries.
    pub async fn list(pool: &PgPool, user_id: Uuid) -> Result<Vec<GifFavoriteRow>, JolkrError> {
        let rows = sqlx::query_as::<_, GifFavoriteRow>(
            "SELECT * FROM gif_favorites WHERE user_id = $1 ORDER BY added_at DESC",
        )
        .bind(user_id)
        .fetch_all(pool)
        .await?;
        Ok(rows)
    }

    /// Add.
    pub async fn add(
        pool: &PgPool,
        user_id: Uuid,
        gif_id: &str,
        gif_url: &str,
        preview_url: &str,
        title: &str,
    ) -> Result<GifFavoriteRow, JolkrError> {
        let id = Uuid::new_v4();
        let row = sqlx::query_as::<_, GifFavoriteRow>(
            "INSERT INTO gif_favorites (id, user_id, gif_id, gif_url, preview_url, title)
               VALUES ($1, $2, $3, $4, $5, $6)
               ON CONFLICT (user_id, gif_id) DO UPDATE SET id = gif_favorites.id
               RETURNING *",
        )
        .bind(id)
        .bind(user_id)
        .bind(gif_id)
        .bind(gif_url)
        .bind(preview_url)
        .bind(title)
        .fetch_one(pool)
        .await?;
        Ok(row)
    }

    /// Find any stored favorite by `gif_id` (any user). Used for URL resolution.
    pub async fn find_by_gif_id(pool: &PgPool, gif_id: &str) -> Result<Option<GifFavoriteRow>, JolkrError> {
        let row = sqlx::query_as::<_, GifFavoriteRow>(
            "SELECT * FROM gif_favorites WHERE gif_id = $1 LIMIT 1",
        )
        .bind(gif_id)
        .fetch_optional(pool)
        .await?;
        Ok(row)
    }

    /// Removes an entry.
    pub async fn remove(pool: &PgPool, user_id: Uuid, gif_id: &str) -> Result<(), JolkrError> {
        sqlx::query("DELETE FROM gif_favorites WHERE user_id = $1 AND gif_id = $2")
            .bind(user_id)
            .bind(gif_id)
            .execute(pool)
            .await?;
        Ok(())
    }
}
