use lettre::message::header::ContentType;
use lettre::transport::smtp::client::Tls;
use lettre::{Message, SmtpTransport, Transport};
use tracing::{info, warn};

/// Simple email service wrapping lettre SMTP transport.
/// Falls back to logging the reset URL if SMTP is not configured.
#[derive(Clone)]
pub struct EmailService {
    mailer: Option<SmtpTransport>,
    from: String,
}

impl EmailService {
    /// Create a new EmailService. If `smtp_host` is None, emails are logged instead.
    pub fn new(smtp_host: Option<&str>, smtp_port: u16, smtp_from: &str) -> Self {
        let mailer = smtp_host.map(|host| {
            SmtpTransport::builder_dangerous(host)
                .port(smtp_port)
                .tls(Tls::None)
                .build()
        });

        if mailer.is_some() {
            info!(host = ?smtp_host, port = smtp_port, "SMTP email service configured");
        } else {
            warn!("SMTP not configured — password reset URLs will be logged to console");
        }

        Self {
            mailer,
            from: smtp_from.to_string(),
        }
    }

    /// Send a password reset email. If SMTP is not configured, logs the reset URL.
    pub fn send_password_reset(&self, to_email: &str, username: &str, reset_url: &str) {
        if let Some(ref mailer) = self.mailer {
            let html_body = format!(
                r#"<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #7C3AED;">Jolkr — Password Reset</h2>
  <p>Hi <strong>{username}</strong>,</p>
  <p>We received a request to reset your password. Click the button below to set a new password:</p>
  <p style="text-align: center; margin: 30px 0;">
    <a href="{reset_url}" style="background-color: #7C3AED; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600;">Reset Password</a>
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

            let email = Message::builder()
                .from(self.from.parse().unwrap_or_else(|_| {
                    "noreply@jolkr.app".parse().expect("valid fallback from address")
                }))
                .to(to_email.parse().unwrap_or_else(|_| {
                    warn!(to_email, "Invalid recipient email address");
                    return "invalid@localhost".parse().expect("valid fallback");
                }))
                .subject("Reset your Jolkr password")
                .header(ContentType::TEXT_HTML)
                .body(html_body);

            let email = match email {
                Ok(email) => email,
                Err(e) => {
                    warn!("Failed to build email: {e}");
                    // Try a minimal plaintext fallback — if this also fails, just log and return
                    match Message::builder()
                        .from(self.from.parse().unwrap_or_else(|_| "noreply@jolkr.app".parse().expect("valid fallback")))
                        .to(match to_email.parse() {
                            Ok(addr) => addr,
                            Err(e2) => {
                                warn!(to_email, error = %e2, "Fallback email also failed: invalid recipient");
                                return;
                            }
                        })
                        .subject("Password Reset")
                        .body(format!("Reset your password: {reset_url}"))
                    {
                        Ok(fallback) => fallback,
                        Err(e2) => {
                            warn!(error = %e2, "Fallback email build also failed — skipping send");
                            return;
                        }
                    }
                }
            };

            match mailer.send(&email) {
                Ok(_) => info!(to = to_email, "Password reset email sent"),
                Err(e) => warn!(to = to_email, error = %e, "Failed to send password reset email — logging URL as fallback"),
            }
        } else {
            // Dev fallback: log the reset URL
            info!("══════════════════════════════════════════════════════════");
            info!("PASSWORD RESET for {to_email} ({username})");
            info!("URL: {reset_url}");
            info!("══════════════════════════════════════════════════════════");
        }
    }
}
