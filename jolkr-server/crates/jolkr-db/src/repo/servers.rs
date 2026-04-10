use chrono::Utc;
use sqlx::PgPool;
use uuid::Uuid;

use crate::models::ServerRow;
use jolkr_common::JolkrError;

pub struct ServerRepo;

impl ServerRepo {
    /// Create a new server and add the owner as the first member.
    pub async fn create_server(
        pool: &PgPool,
        id: Uuid,
        name: &str,
        description: Option<&str>,
        owner_id: Uuid,
    ) -> Result<ServerRow, JolkrError> {
        let now = Utc::now();

        // Create the server row
        let server = sqlx::query_as::<_, ServerRow>(
            r#"
            INSERT INTO servers (id, name, description, owner_id, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $5)
            RETURNING *
            "#,
        )
        .bind(id)
        .bind(name)
        .bind(description)
        .bind(owner_id)
        .bind(now)
        .fetch_one(pool)
        .await?;

        // Also create a membership record for the owner
        let member_id = Uuid::new_v4();
        sqlx::query(
            r#"
            INSERT INTO members (id, server_id, user_id, joined_at)
            VALUES ($1, $2, $3, $4)
            "#,
        )
        .bind(member_id)
        .bind(id)
        .bind(owner_id)
        .bind(now)
        .execute(pool)
        .await?;

        Ok(server)
    }

    /// Fetch a server by ID.
    pub async fn get_by_id(pool: &PgPool, id: Uuid) -> Result<ServerRow, JolkrError> {
        let server = sqlx::query_as::<_, ServerRow>(
            r#"SELECT * FROM servers WHERE id = $1"#,
        )
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or(JolkrError::NotFound)?;

        Ok(server)
    }

    /// List all servers that a user is a member of.
    pub async fn list_for_user(
        pool: &PgPool,
        user_id: Uuid,
    ) -> Result<Vec<ServerRow>, JolkrError> {
        let servers = sqlx::query_as::<_, ServerRow>(
            r#"
            SELECT s.* FROM servers s
            INNER JOIN members m ON m.server_id = s.id
            WHERE m.user_id = $1
            ORDER BY m.server_position ASC, s.name ASC
            "#,
        )
        .bind(user_id)
        .fetch_all(pool)
        .await?;

        Ok(servers)
    }

    /// List public servers for discovery, ordered by member count descending.
    pub async fn list_public(
        pool: &PgPool,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<ServerRow>, JolkrError> {
        let rows = sqlx::query_as::<_, ServerRow>(
            r#"
            SELECT s.*
            FROM servers s
            WHERE s.is_public = true
            ORDER BY s.created_at DESC
            LIMIT $1 OFFSET $2
            "#,
        )
        .bind(limit)
        .bind(offset)
        .fetch_all(pool)
        .await?;

        Ok(rows)
    }

    /// Count members for a server.
    pub async fn count_members(pool: &PgPool, server_id: Uuid) -> Result<i64, JolkrError> {
        let count: (i64,) = sqlx::query_as(
            r#"SELECT COUNT(*) FROM members WHERE server_id = $1"#,
        )
        .bind(server_id)
        .fetch_one(pool)
        .await?;
        Ok(count.0)
    }

    /// Count members for multiple servers in one query.
    pub async fn count_members_batch(pool: &PgPool, server_ids: &[Uuid]) -> Result<std::collections::HashMap<Uuid, i64>, JolkrError> {
        let rows: Vec<(Uuid, i64)> = sqlx::query_as(
            r#"SELECT server_id, COUNT(*) FROM members WHERE server_id = ANY($1) GROUP BY server_id"#,
        )
        .bind(server_ids)
        .fetch_all(pool)
        .await?;
        Ok(rows.into_iter().collect())
    }

    /// Update a server's metadata.
    pub async fn update(
        pool: &PgPool,
        id: Uuid,
        name: Option<&str>,
        description: Option<&str>,
        icon_url: Option<&str>,
        banner_url: Option<&str>,
        is_public: Option<bool>,
        theme: Option<&serde_json::Value>,
    ) -> Result<ServerRow, JolkrError> {
        let now = Utc::now();
        let server = sqlx::query_as::<_, ServerRow>(
            r#"
            UPDATE servers
            SET name        = COALESCE($2, name),
                description = COALESCE($3, description),
                icon_url    = COALESCE($4, icon_url),
                banner_url  = COALESCE($5, banner_url),
                is_public   = COALESCE($6, is_public),
                theme       = COALESCE($7, theme),
                updated_at  = $8
            WHERE id = $1
            RETURNING *
            "#,
        )
        .bind(id)
        .bind(name)
        .bind(description)
        .bind(icon_url)
        .bind(banner_url)
        .bind(is_public)
        .bind(theme)
        .bind(now)
        .fetch_optional(pool)
        .await?
        .ok_or(JolkrError::NotFound)?;

        Ok(server)
    }

    /// Delete a server.
    pub async fn delete(pool: &PgPool, id: Uuid) -> Result<(), JolkrError> {
        let result = sqlx::query(r#"DELETE FROM servers WHERE id = $1"#)
            .bind(id)
            .execute(pool)
            .await?;

        if result.rows_affected() == 0 {
            return Err(JolkrError::NotFound);
        }
        Ok(())
    }
}
