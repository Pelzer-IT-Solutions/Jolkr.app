use lettre::message::header::ContentType;
use lettre::transport::smtp::authentication::Credentials;
use lettre::transport::smtp::client::Tls;
use lettre::{Message, SmtpTransport, Transport};
use tracing::{info, warn};

/// Email service wrapping lettre SMTP transport with authentication.
/// Falls back to logging if SMTP is not configured.
#[derive(Clone)]
pub struct EmailService {
    mailer: Option<SmtpTransport>,
    from: String,
}

impl EmailService {
    /// Create a new EmailService.
    /// If `host` is None, emails are logged instead of sent.
    /// Uses plaintext for local dev hosts, STARTTLS + auth for production.
    pub fn new(
        host: Option<&str>,
        port: u16,
        from: &str,
        username: Option<&str>,
        password: Option<&str>,
    ) -> Self {
        let mailer = host.map(|host| {
            let is_local = host == "mailhog" || host == "localhost" || host == "127.0.0.1";
            let mut builder = if is_local {
                SmtpTransport::builder_dangerous(host)
                    .port(port)
                    .tls(Tls::None)
            } else {
                SmtpTransport::starttls_relay(host)
                    .unwrap_or_else(|_| {
                        warn!(host, "STARTTLS relay failed, falling back to dangerous builder");
                        SmtpTransport::builder_dangerous(host)
                    })
                    .port(port)
            };

            if let (Some(user), Some(pass)) = (username, password) {
                builder = builder.credentials(Credentials::new(user.to_string(), pass.to_string()));
            }

            builder.build()
        });

        if mailer.is_some() {
            info!(host = ?host, port = port, "SMTP email service configured");
        } else {
            warn!("SMTP not configured — emails will be logged to console");
        }

        Self {
            mailer,
            from: from.to_string(),
        }
    }

    /// Send an email. Returns true if sent, false if logged as fallback.
    fn send_email(&self, to: &str, subject: &str, html_body: String) -> bool {
        if let Some(ref mailer) = self.mailer {
            let email = match Message::builder()
                .from(self.from.parse().unwrap_or_else(|_| {
                    "noreply@jolkr.app".parse().expect("valid fallback from address")
                }))
                .to(match to.parse() {
                    Ok(addr) => addr,
                    Err(e) => {
                        warn!(to, error = %e, "Invalid recipient email address");
                        return false;
                    }
                })
                .subject(subject)
                .header(ContentType::TEXT_HTML)
                .body(html_body)
            {
                Ok(email) => email,
                Err(e) => {
                    warn!(error = %e, "Failed to build email");
                    return false;
                }
            };

            match mailer.send(&email) {
                Ok(_) => {
                    info!(to = to, subject = subject, "Email sent");
                    true
                }
                Err(e) => {
                    warn!(to = to, error = %e, "Failed to send email");
                    false
                }
            }
        } else {
            false
        }
    }

    /// Send a password reset email.
    pub fn send_password_reset(&self, to_email: &str, username: &str, reset_url: &str) {
        let html_body = format!(
            r#"<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #2DD4BF;">Jolkr — Password Reset</h2>
  <p>Hi <strong>{username}</strong>,</p>
  <p>We received a request to reset your password. Click the button below to set a new password:</p>
  <p style="text-align: center; margin: 30px 0;">
    <a href="{reset_url}" style="background-color: #2DD4BF; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600;">Reset Password</a>
  </p>
  <p style="color: #666; font-size: 14px;">This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
  <p style="color: #666; font-size: 14px;">Or copy this link: <a href="{reset_url}">{reset_url}</a></p>
  <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
  <p style="color: #999; font-size: 12px;">Jolkr — Privacy-first chat</p>
</body>
</html>"#,
            username = username,
            reset_url = reset_url,
        );

        if !self.send_email(to_email, "Reset your Jolkr password", html_body) {
            info!("══════════════════════════════════════════════════════════");
            info!("PASSWORD RESET for {to_email} ({username})");
            info!("URL: {reset_url}");
            info!("══════════════════════════════════════════════════════════");
        }
    }

    /// Send an email verification email.
    pub fn send_verification_email(&self, to_email: &str, username: &str, verify_url: &str) {
        let html_body = format!(
            r#"<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #2DD4BF;">Welcome to Jolkr!</h2>
  <p>Hi <strong>{username}</strong>,</p>
  <p>Thanks for signing up! Please verify your email address to get started:</p>
  <p style="text-align: center; margin: 30px 0;">
    <a href="{verify_url}" style="background-color: #2DD4BF; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600;">Verify Email</a>
  </p>
  <p style="color: #666; font-size: 14px;">This link expires in 24 hours.</p>
  <p style="color: #666; font-size: 14px;">Or copy this link: <a href="{verify_url}">{verify_url}</a></p>
  <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
  <p style="color: #999; font-size: 12px;">Jolkr — Privacy-first chat</p>
</body>
</html>"#,
            username = username,
            verify_url = verify_url,
        );

        if !self.send_email(to_email, "Verify your Jolkr email", html_body) {
            info!("══════════════════════════════════════════════════════════");
            info!("EMAIL VERIFICATION for {to_email} ({username})");
            info!("URL: {verify_url}");
            info!("══════════════════════════════════════════════════════════");
        }
    }
}
