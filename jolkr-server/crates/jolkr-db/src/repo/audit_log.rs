use sqlx::PgPool;
use uuid::Uuid;

use crate::models::AuditLogRow;
use jolkr_common::JolkrError;

pub struct AuditLogRepo;

impl AuditLogRepo {
    /// Create a new audit log entry.
    pub async fn create(
        pool: &PgPool,
        server_id: Uuid,
        user_id: Uuid,
        action_type: &str,
        target_id: Option<Uuid>,
        target_type: Option<&str>,
        changes: Option<serde_json::Value>,
        reason: Option<&str>,
    ) -> Result<AuditLogRow, JolkrError> {
        let id = Uuid::new_v4();
        let row = sqlx::query_as::<_, AuditLogRow>(
            r#"
            INSERT INTO audit_log (id, server_id, user_id, action_type, target_id, target_type, changes, reason)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *
            "#,
        )
        .bind(id)
        .bind(server_id)
        .bind(user_id)
        .bind(action_type)
        .bind(target_id)
        .bind(target_type)
        .bind(changes)
        .bind(reason)
        .fetch_one(pool)
        .await?;

        Ok(row)
    }

    /// List audit log entries for a server (paginated, newest first).
    pub async fn list_for_server(
        pool: &PgPool,
        server_id: Uuid,
        action_type: Option<&str>,
        limit: i64,
        before: Option<chrono::DateTime<chrono::Utc>>,
    ) -> Result<Vec<AuditLogRow>, JolkrError> {
        let rows = if let Some(action) = action_type {
            if let Some(before_ts) = before {
                sqlx::query_as::<_, AuditLogRow>(
                    r#"
                    SELECT * FROM audit_log
                    WHERE server_id = $1 AND action_type = $2 AND created_at < $3
                    ORDER BY created_at DESC
                    LIMIT $4
                    "#,
                )
                .bind(server_id)
                .bind(action)
                .bind(before_ts)
                .bind(limit)
                .fetch_all(pool)
                .await?
            } else {
                sqlx::query_as::<_, AuditLogRow>(
                    r#"
                    SELECT * FROM audit_log
                    WHERE server_id = $1 AND action_type = $2
                    ORDER BY created_at DESC
                    LIMIT $3
                    "#,
                )
                .bind(server_id)
                .bind(action)
                .bind(limit)
                .fetch_all(pool)
                .await?
            }
        } else if let Some(before_ts) = before {
            sqlx::query_as::<_, AuditLogRow>(
                r#"
                SELECT * FROM audit_log
                WHERE server_id = $1 AND created_at < $2
                ORDER BY created_at DESC
                LIMIT $3
                "#,
            )
            .bind(server_id)
            .bind(before_ts)
            .bind(limit)
            .fetch_all(pool)
            .await?
        } else {
            sqlx::query_as::<_, AuditLogRow>(
                r#"
                SELECT * FROM audit_log
                WHERE server_id = $1
                ORDER BY created_at DESC
                LIMIT $2
                "#,
            )
            .bind(server_id)
            .bind(limit)
            .fetch_all(pool)
            .await?
        };

        Ok(rows)
    }
}
