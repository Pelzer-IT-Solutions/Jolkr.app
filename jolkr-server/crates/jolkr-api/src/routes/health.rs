use std::sync::OnceLock;
use std::time::Instant;

use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{Html, IntoResponse, Response};
use serde::Serialize;
use tokio::time::{timeout, Duration};

use super::AppState;

/// Application start time for uptime calculation.
static START_TIME: OnceLock<Instant> = OnceLock::new();

/// Call once at startup to record the start time.
pub(crate) fn init_start_time() {
    START_TIME.get_or_init(Instant::now);
}

fn uptime_seconds() -> u64 {
    START_TIME
        .get()
        .map(|t| t.elapsed().as_secs())
        .unwrap_or(0)
}

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
    uptime_seconds: u64,
    services: Services,
    pool: PoolStats,
}

#[derive(Serialize)]
struct PoolStats {
    size: u32,
    idle: u32,
    max: u32,
}

#[derive(Serialize)]
struct Services {
    database: ServiceStatus,
    cache: ServiceStatus,
    storage: ServiceStatus,
    events: ServiceStatus,
    relay: ServiceStatus,
}

#[derive(Serialize, Clone)]
struct ServiceStatus {
    status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    latency_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

impl ServiceStatus {
    fn up(latency_ms: u64) -> Self {
        Self {
            status: "up",
            latency_ms: Some(latency_ms),
            error: None,
        }
    }

    fn down(error: String) -> Self {
        Self {
            status: "down",
            latency_ms: None,
            error: Some(error),
        }
    }
}

/// Check a single service with a timeout.
async fn check_postgres(state: &AppState) -> ServiceStatus {
    let start = Instant::now();
    match timeout(Duration::from_secs(5), sqlx::query("SELECT 1").fetch_one(&state.pool)).await {
        Ok(Ok(_)) => ServiceStatus::up(start.elapsed().as_millis() as u64),
        Ok(Err(e)) => ServiceStatus::down(e.to_string()),
        Err(_) => ServiceStatus::down("timeout".into()),
    }
}

async fn check_redis(state: &AppState) -> ServiceStatus {
    let start = Instant::now();
    match timeout(Duration::from_secs(5), state.redis.ping()).await {
        Ok(Ok(())) => ServiceStatus::up(start.elapsed().as_millis() as u64),
        Ok(Err(e)) => ServiceStatus::down(e),
        Err(_) => ServiceStatus::down("timeout".into()),
    }
}

async fn check_minio(state: &AppState) -> ServiceStatus {
    let start = Instant::now();
    match timeout(Duration::from_secs(5), state.storage.ping()).await {
        Ok(Ok(())) => ServiceStatus::up(start.elapsed().as_millis() as u64),
        Ok(Err(e)) => ServiceStatus::down(e),
        Err(_) => ServiceStatus::down("timeout".into()),
    }
}

async fn check_relay(url: &str) -> ServiceStatus {
    let start = Instant::now();
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build();
    let client = match client {
        Ok(c) => c,
        Err(e) => return ServiceStatus::down(e.to_string()),
    };
    match client.get(format!("{url}/health")).send().await {
        Ok(resp) if resp.status().is_success() => ServiceStatus::up(start.elapsed().as_millis() as u64),
        Ok(resp) => ServiceStatus::down(format!("status {}", resp.status())),
        Err(e) => ServiceStatus::down(e.to_string()),
    }
}

fn check_nats(state: &AppState) -> ServiceStatus {
    use async_nats::connection::State as NatsState;
    match state.nats.connection_state() {
        NatsState::Connected => ServiceStatus::up(0),
        NatsState::Disconnected => ServiceStatus::down("disconnected".into()),
        NatsState::Pending => ServiceStatus::down("connecting".into()),
    }
}

pub(crate) async fn health_check(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Response {
    // Run all checks concurrently
    let (db, cache, storage, relay) = tokio::join!(
        check_postgres(&state),
        check_redis(&state),
        check_minio(&state),
        check_relay(&state.media_server_url),
    );
    let events = check_nats(&state);

    let all_up = db.status == "up" && cache.status == "up" && storage.status == "up"
        && events.status == "up" && relay.status == "up";
    let critical_down = db.status == "down" || cache.status == "down";

    let overall = if all_up {
        "healthy"
    } else if critical_down {
        "unhealthy"
    } else {
        "degraded"
    };

    let http_status = if critical_down {
        StatusCode::SERVICE_UNAVAILABLE
    } else {
        StatusCode::OK
    };

    let services = Services {
        database: db,
        cache,
        storage,
        events,
        relay,
    };

    let uptime = uptime_seconds();

    // Content negotiation: HTML for browsers, JSON for everything else
    let wants_html = headers
        .get("accept")
        .and_then(|v| v.to_str().ok())
        .map(|v| v.contains("text/html"))
        .unwrap_or(false);

    let pool_stats = PoolStats {
        size: state.pool.size(),
        idle: state.pool.num_idle() as u32,
        max: 30,
    };

    if wants_html {
        let html = render_html(overall, uptime, &services);
        (http_status, Html(html)).into_response()
    } else {
        let body = HealthResponse {
            status: overall,
            uptime_seconds: uptime,
            services,
            pool: pool_stats,
        };
        (http_status, axum::Json(body)).into_response()
    }
}

fn format_uptime(seconds: u64) -> String {
    let days = seconds / 86400;
    let hours = (seconds % 86400) / 3600;
    let mins = (seconds % 3600) / 60;
    let secs = seconds % 60;
    if days > 0 {
        format!("{days}d {hours}h {mins}m {secs}s")
    } else if hours > 0 {
        format!("{hours}h {mins}m {secs}s")
    } else if mins > 0 {
        format!("{mins}m {secs}s")
    } else {
        format!("{secs}s")
    }
}

fn service_row(name: &str, s: &ServiceStatus) -> String {
    let (color, status_text) = if s.status == "up" {
        ("#3FB950", "Operational")
    } else {
        ("#F85149", "Down")
    };

    let latency = s
        .latency_ms
        .map(|ms| format!("{ms}ms"))
        .unwrap_or_default();

    let error_html = s
        .error
        .as_ref()
        .map(|e| format!(r#"<span class="row-error">({e})</span>"#))
        .unwrap_or_default();

    format!(
        r#"<div class="row">
  <div class="row-left">
    <span class="row-dot" style="color:{color}">●</span>
    <span class="row-name">{name}</span>
    {error_html}
  </div>
  <div class="row-right">
    <span class="row-latency">{latency}</span>
    <span class="row-status" style="color:{color}">{status_text}</span>
  </div>
</div>"#
    )
}

fn render_html(overall: &str, uptime: u64, services: &Services) -> String {
    let (badge_color, badge_bg) = match overall {
        "healthy" => ("#3FB950", "rgba(63,185,80,0.12)"),
        "degraded" => ("#E3B341", "rgba(227,179,65,0.12)"),
        _ => ("#F85149", "rgba(248,81,73,0.12)"),
    };

    let badge_text = match overall {
        "healthy" => "All Systems Operational",
        "degraded" => "Degraded Performance",
        _ => "Service Disruption",
    };

    let uptime_str = format_uptime(uptime);

    let rows = [
        service_row("Database", &services.database),
        service_row("Cache", &services.cache),
        service_row("Storage", &services.storage),
        service_row("Event Bus", &services.events),
        service_row("Relay", &services.relay),
    ]
    .join("\n");

    // Tokens / fonts / dot-pattern background mirror the landing page.
    // Kept inline so /health stays self-contained (no external CSS asset).
    // r##"..."## delimiter: the inline HTML embeds `"#hex"` color literals
    // (e.g. `content="#e7ecec"`), and a single-hash raw string would treat
    // `"#` as the closing delimiter and break compilation.
    format!(
        r##"<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="30">
<title>Jolkr — Service Status</title>
<link rel="icon" type="image/png" href="https://jolkr.app/favicon/favicon-96x96.png" sizes="96x96">
<link rel="icon" type="image/svg+xml" href="https://jolkr.app/favicon/favicon.svg">
<link rel="shortcut icon" href="https://jolkr.app/favicon/favicon.ico">
<link rel="apple-touch-icon" sizes="180x180" href="https://jolkr.app/favicon/apple-touch-icon.png">
<meta name="theme-color" content="#e7ecec" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#161a1a" media="(prefers-color-scheme: dark)">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Uncial+Antiqua&display=swap" rel="stylesheet">
<style>
  *,*::before,*::after{{margin:0;padding:0;box-sizing:border-box}}
  :root{{
    color-scheme: light dark;
    --theme-hue: 182;
    --bg-primary: oklch(93% 0.004 var(--theme-hue));
    --bg-surface: oklch(97.5% 0.004 var(--theme-hue));
    --border-primary: oklch(25.42% 0.004 var(--theme-hue) / 0.16);
    --text-primary: oklch(25.42% 0.004 var(--theme-hue));
    --text-secondary: oklch(25.42% 0.004 var(--theme-hue) / 0.7);
    --text-tertiary: oklch(25.42% 0.004 var(--theme-hue) / 0.4);
    --accent: #697B4B;
    --accent-hover: #788764;
    --shadow-card: 0 4px 16px oklch(0% 0 0 / 0.08);
    --dot-color: oklch(25.42% 0.004 var(--theme-hue) / 0.12);
    --font-display: 'Uncial Antiqua', Georgia, 'Times New Roman', serif;
  }}
  @media (prefers-color-scheme: dark){{
    :root{{
      --bg-primary: #141414;
      --bg-surface: #202020;
      --border-primary: oklch(99% 0.004 var(--theme-hue) / 0.16);
      --text-primary: oklch(99% 0.004 var(--theme-hue));
      --text-secondary: oklch(99% 0.004 var(--theme-hue) / 0.7);
      --text-tertiary: oklch(99% 0.004 var(--theme-hue) / 0.4);
      --shadow-card: 0 4px 16px oklch(0% 0 0 / 0.35);
      --dot-color: rgba(255,255,255,0.07);
    }}
  }}
  body{{
    font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
    -webkit-font-smoothing:antialiased;
    -moz-osx-font-smoothing:grayscale;
    background:var(--bg-primary);
    color:var(--text-primary);
    min-height:100vh;
    display:flex;
    flex-direction:column;
    align-items:center;
    padding:56px 16px 40px;
    position:relative;
    overflow-x:hidden;
  }}
  body::before{{
    content:'';
    position:absolute;
    top:0;left:0;right:0;
    height:120vh;
    z-index:0;
    pointer-events:none;
    background-image:
      radial-gradient(circle, var(--dot-color) 1.5px, transparent 1.5px),
      radial-gradient(circle, var(--dot-color) 1.5px, transparent 1.5px);
    background-size:28px 48px;
    background-position:0 0, 14px 24px;
    -webkit-mask-image:radial-gradient(ellipse 100% 90% at 50% 0%, black 0%, transparent 88%);
    mask-image:radial-gradient(ellipse 100% 90% at 50% 0%, black 0%, transparent 88%);
  }}
  a{{color:var(--accent);text-decoration:none;transition:color .15s}}
  a:hover{{color:var(--accent-hover)}}
  .container{{position:relative;z-index:1;max-width:600px;width:100%}}
  .header{{display:flex;flex-direction:column;align-items:center;gap:14px;margin-bottom:32px;text-align:center}}
  .brand{{display:flex;align-items:center;gap:10px}}
  .brand img{{width:32px;height:32px;border-radius:24%}}
  .brand h1{{font-family:var(--font-display);font-size:28px;font-weight:400;letter-spacing:0.02em;color:var(--text-primary)}}
  .badge{{display:inline-flex;align-items:center;gap:6px;padding:6px 14px;border-radius:999px;font-size:14px;font-weight:500;background:{badge_bg};color:{badge_color}}}
  .meta{{display:flex;justify-content:space-between;font-size:13px;color:var(--text-tertiary);margin-bottom:16px;padding:0 4px}}
  .row{{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;background:var(--bg-surface);border:1px solid var(--border-primary);border-radius:12px;margin-bottom:8px;box-shadow:var(--shadow-card)}}
  .row-left{{display:flex;align-items:center;gap:10px}}
  .row-dot{{font-size:18px;line-height:1}}
  .row-name{{font-weight:500;color:var(--text-primary)}}
  .row-error{{color:var(--text-tertiary);font-size:12px;margin-left:8px}}
  .row-right{{display:flex;align-items:center;gap:12px}}
  .row-latency{{color:var(--text-tertiary);font-size:13px}}
  .row-status{{font-size:13px;font-weight:500}}
  .footer{{text-align:center;margin-top:32px;font-size:12px;color:var(--text-tertiary)}}
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <div class="brand">
      <img src="https://jolkr.app/favicon/favicon.svg" alt="Jolkr" width="32" height="32">
      <h1>Jolkr Status</h1>
    </div>
    <div class="badge">
      <span style="font-size:16px;line-height:1">●</span> {badge_text}
    </div>
  </div>
  <div class="meta">
    <span>Uptime: {uptime_str}</span>
    <span>Auto-refresh: 30s</span>
  </div>
  {rows}
  <div class="footer">
    Powered by <a href="https://jolkr.app">jolkr.app</a>
  </div>
</div>
</body>
</html>"##
    )
}
