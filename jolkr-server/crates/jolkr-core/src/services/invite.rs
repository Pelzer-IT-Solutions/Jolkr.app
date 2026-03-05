use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

use jolkr_common::{JolkrError, Permissions};
use jolkr_db::models::InviteRow;
use jolkr_db::repo::{BanRepo, InviteRepo, MemberRepo, RoleRepo, ServerRepo};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InviteInfo {
    pub id: Uuid,
    pub server_id: Uuid,
    pub code: String,
    pub creator_id: Uuid,
    pub max_uses: Option<i32>,
    pub use_count: i32,
    pub expires_at: Option<chrono::DateTime<chrono::Utc>>,
}

impl From<InviteRow> for InviteInfo {
    fn from(row: InviteRow) -> Self {
        Self {
            id: row.id,
            server_id: row.server_id,
            code: row.code,
            creator_id: row.creator_id,
            max_uses: row.max_uses,
            use_count: row.use_count,
            expires_at: row.expires_at,
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct CreateInviteRequest {
    pub max_uses: Option<i32>,
    pub max_age_seconds: Option<i64>,
}

pub struct InviteService;

impl InviteService {
    pub async fn create_invite(
        pool: &PgPool,
        server_id: Uuid,
        creator_id: Uuid,
        req: CreateInviteRequest,
    ) -> Result<InviteInfo, JolkrError> {
        // Verify caller is a member and has CREATE_INVITE permission
        let member = MemberRepo::get_member(pool, server_id, creator_id).await?;
        let server = ServerRepo::get_by_id(pool, server_id).await?;
        if server.owner_id != creator_id {
            let perms = RoleRepo::compute_permissions(pool, server_id, member.id).await?;
            if !Permissions::from(perms).has(Permissions::CREATE_INVITE) {
                return Err(JolkrError::Forbidden);
            }
        }

        // Validate max_uses
        if let Some(max_uses) = req.max_uses {
            if max_uses < 1 {
                return Err(JolkrError::Validation("max_uses must be at least 1".into()));
            }
        }

        // Validate max_age_seconds
        if let Some(secs) = req.max_age_seconds {
            if secs < 1 {
                return Err(JolkrError::Validation("max_age_seconds must be at least 1".into()));
            }
        }

        let code = Self::generate_code();
        let expires_at = req.max_age_seconds.map(|secs| {
            chrono::Utc::now() + chrono::Duration::seconds(secs)
        });

        let row = InviteRepo::create_invite(
            pool, server_id, creator_id, &code, req.max_uses, expires_at,
        )
        .await?;
        Ok(InviteInfo::from(row))
    }

    pub async fn use_invite(
        pool: &PgPool,
        code: &str,
        user_id: Uuid,
    ) -> Result<InviteInfo, JolkrError> {
        let invite = InviteRepo::get_by_code(pool, code).await?;

        // Check if user is banned from this server
        if BanRepo::is_banned(pool, invite.server_id, user_id).await? {
            return Err(JolkrError::Forbidden);
        }

        // Atomically increment use count — returns false if invite is exhausted/expired
        let incremented = InviteRepo::use_invite(pool, invite.id).await?;
        if !incremented {
            return Err(JolkrError::BadRequest(
                "This invite has expired or reached its maximum number of uses".into(),
            ));
        }

        // Add user as member (ON CONFLICT handles race condition)
        MemberRepo::add_member(pool, invite.server_id, user_id)
            .await
            .map_err(|e| {
                if let JolkrError::Conflict(_) = e {
                    return JolkrError::Conflict("Already a member of this server".into());
                }
                e
            })?;

        Ok(InviteInfo::from(invite))
    }

    pub async fn list_invites(
        pool: &PgPool,
        server_id: Uuid,
        caller_id: Uuid,
    ) -> Result<Vec<InviteInfo>, JolkrError> {
        // Verify caller is a member
        MemberRepo::get_member(pool, server_id, caller_id).await?;

        let rows = InviteRepo::list_for_server(pool, server_id).await?;
        Ok(rows.into_iter().map(InviteInfo::from).collect())
    }

    pub async fn delete_invite(
        pool: &PgPool,
        invite_id: Uuid,
        caller_id: Uuid,
        server_id: Uuid,
    ) -> Result<(), JolkrError> {
        // Verify invite belongs to this server
        let invite = InviteRepo::get_by_id(pool, invite_id).await?;
        if invite.server_id != server_id {
            return Err(JolkrError::NotFound);
        }

        // Only server owner or invite creator can delete
        let server = ServerRepo::get_by_id(pool, server_id).await?;
        if server.owner_id != caller_id && invite.creator_id != caller_id {
            return Err(JolkrError::Forbidden);
        }
        InviteRepo::delete_invite(pool, invite_id).await
    }

    fn generate_code() -> String {
        use rand::Rng;
        const CHARSET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
        let mut rng = rand::thread_rng();
        (0..8)
            .map(|_| {
                let idx = rng.gen_range(0..CHARSET.len());
                CHARSET[idx] as char
            })
            .collect()
    }
}
