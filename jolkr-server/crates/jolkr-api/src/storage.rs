use s3::bucket::Bucket;
use s3::creds::Credentials;
use s3::error::S3Error;
use s3::Region;
use tracing::{error, info};
use uuid::Uuid;

/// S3-compatible object storage client (MinIO).
#[derive(Clone)]
pub struct Storage {
    bucket: Box<Bucket>,
}

/// Maximum file size: 250 MB.
pub const MAX_FILE_SIZE: usize = 250 * 1024 * 1024;

impl Storage {
    /// Connect to MinIO / S3 and ensure the bucket exists.
    pub async fn new(
        endpoint: &str,
        access_key: &str,
        secret_key: &str,
        bucket_name: &str,
    ) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let region = Region::Custom {
            region: "us-east-1".to_string(),
            endpoint: endpoint.to_string(),
        };

        let credentials = Credentials::new(
            Some(access_key),
            Some(secret_key),
            None,
            None,
            None,
        )?;

        let mut bucket = Bucket::new(bucket_name, region.clone(), credentials.clone())?;
        bucket.set_path_style();

        // Try to create the bucket if it doesn't exist (ignore "already exists" errors)
        match Bucket::create_with_path_style(bucket_name, region, credentials, Default::default()).await {
            Ok(_) => info!(bucket = bucket_name, "Created S3 bucket"),
            Err(e) => {
                let msg = e.to_string();
                if msg.contains("BucketAlreadyOwnedByYou") || msg.contains("BucketAlreadyExists") {
                    info!(bucket = bucket_name, "S3 bucket already exists");
                } else {
                    // Log but don't fail — bucket might already exist in MinIO
                    info!(bucket = bucket_name, error = %e, "S3 bucket create response (may already exist)");
                }
            }
        }

        info!(endpoint = endpoint, bucket = bucket_name, "S3 storage connected");
        Ok(Self { bucket })
    }

    /// Check MinIO/S3 connectivity by listing the bucket.
    pub async fn ping(&self) -> Result<(), String> {
        self.bucket
            .head_object("/")
            .await
            .map(|_| ())
            .or_else(|e| {
                // A 404 is fine — it means MinIO is reachable but the key doesn't exist
                let msg = e.to_string();
                if msg.contains("404") || msg.contains("NoSuchKey") {
                    Ok(())
                } else {
                    Err(msg)
                }
            })
    }

    /// Upload a file and return the object key.
    ///
    /// Key format: `{prefix}/{uuid}.{ext}` where prefix is "attachments", "avatars", etc.
    pub async fn upload(
        &self,
        prefix: &str,
        file_id: Uuid,
        filename: &str,
        content_type: &str,
        data: &[u8],
    ) -> Result<String, String> {
        let ext = filename
            .rsplit('.')
            .next()
            .unwrap_or("bin");
        let key = format!("{prefix}/{file_id}.{ext}");

        match self.bucket.put_object_with_content_type(&key, data, content_type).await {
            Ok(response) => {
                if response.status_code() >= 200 && response.status_code() < 300 {
                    Ok(key)
                } else {
                    let msg = format!("S3 upload failed with status {}", response.status_code());
                    error!(key = %key, "{}", msg);
                    Err(msg)
                }
            }
            Err(e) => {
                error!(key = %key, error = %e, "S3 upload error");
                Err(e.to_string())
            }
        }
    }

    /// Download an object's bytes and content-type.
    pub async fn get_object(&self, key: &str) -> Result<(Vec<u8>, String), String> {
        let response = self.bucket
            .get_object(key)
            .await
            .map_err(|e| format!("S3 get failed: {e}"))?;

        if response.status_code() == 404 {
            return Err("not_found".to_string());
        }
        if response.status_code() < 200 || response.status_code() >= 300 {
            return Err(format!("S3 get failed with status {}", response.status_code()));
        }

        let content_type = response
            .headers()
            .get("content-type")
            .map(|v| v.to_string())
            .unwrap_or_else(|| "application/octet-stream".to_string());

        Ok((response.to_vec(), content_type))
    }

    /// Generate a presigned download URL (valid for `expires_secs` seconds).
    pub async fn presign_get(&self, key: &str, expires_secs: u32) -> Result<String, String> {
        self.bucket
            .presign_get(key, expires_secs, None)
            .await
            .map_err(|e: S3Error| e.to_string())
    }

    /// Delete an object by key.
    pub async fn delete(&self, key: &str) -> Result<(), String> {
        match self.bucket.delete_object(key).await {
            Ok(_) => Ok(()),
            Err(e) => {
                error!(key = %key, error = %e, "S3 delete error");
                Err(e.to_string())
            }
        }
    }
}
