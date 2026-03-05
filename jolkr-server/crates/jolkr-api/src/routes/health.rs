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
pub fn init_start_time() {
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
}

#[derive(Serialize)]
struct Services {
    database: ServiceStatus,
    cache: ServiceStatus,
    storage: ServiceStatus,
    events: ServiceStatus,
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

fn check_nats(state: &AppState) -> ServiceStatus {
    use async_nats::connection::State as NatsState;
    match state.nats.connection_state() {
        NatsState::Connected => ServiceStatus::up(0),
        NatsState::Disconnected => ServiceStatus::down("disconnected".into()),
        NatsState::Pending => ServiceStatus::down("connecting".into()),
    }
}

pub async fn health_check(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Response {
    // Run all checks concurrently
    let (db, cache, storage) = tokio::join!(
        check_postgres(&state),
        check_redis(&state),
        check_minio(&state),
    );
    let events = check_nats(&state);

    let all_up = db.status == "up" && cache.status == "up" && storage.status == "up" && events.status == "up";
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
    };

    let uptime = uptime_seconds();

    // Content negotiation: HTML for browsers, JSON for everything else
    let wants_html = headers
        .get("accept")
        .and_then(|v| v.to_str().ok())
        .map(|v| v.contains("text/html"))
        .unwrap_or(false);

    if wants_html {
        let html = render_html(overall, uptime, &services);
        (http_status, Html(html)).into_response()
    } else {
        let body = HealthResponse {
            status: overall,
            uptime_seconds: uptime,
            services,
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
    let (dot, color, status_text) = if s.status == "up" {
        ("●", "#22c55e", "Operational")
    } else {
        ("●", "#ef4444", "Down")
    };

    let latency = s
        .latency_ms
        .map(|ms| format!("{ms}ms"))
        .unwrap_or_default();

    let error_html = s
        .error
        .as_ref()
        .map(|e| format!(r#"<span style="color:#94a3b8;font-size:12px;margin-left:8px">({e})</span>"#))
        .unwrap_or_default();

    format!(
        r#"<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:#1e1b2e;border-radius:8px;margin-bottom:8px">
  <div style="display:flex;align-items:center;gap:10px">
    <span style="color:{color};font-size:18px">{dot}</span>
    <span style="font-weight:500">{name}</span>
    {error_html}
  </div>
  <div style="display:flex;align-items:center;gap:12px">
    <span style="color:#94a3b8;font-size:13px">{latency}</span>
    <span style="color:{color};font-size:13px;font-weight:500">{status_text}</span>
  </div>
</div>"#
    )
}

fn render_html(overall: &str, uptime: u64, services: &Services) -> String {
    let (badge_color, badge_bg) = match overall {
        "healthy" => ("#22c55e", "rgba(34,197,94,0.12)"),
        "degraded" => ("#eab308", "rgba(234,179,8,0.12)"),
        _ => ("#ef4444", "rgba(239,68,68,0.12)"),
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
    ]
    .join("\n");

    format!(
        r#"<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="30">
<title>Jolkr — Service Status</title>
<style>
  *{{margin:0;padding:0;box-sizing:border-box}}
  body{{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0f0d1a;color:#e2e8f0;min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:40px 16px}}
  a{{color:#a78bfa;text-decoration:none}}
  .container{{max-width:600px;width:100%}}
  .header{{text-align:center;margin-bottom:32px}}
  .header h1{{font-size:28px;font-weight:700;margin-bottom:4px}}
  .header h1 span{{color:#a78bfa}}
  .badge{{display:inline-flex;align-items:center;gap:6px;padding:6px 14px;border-radius:20px;font-size:14px;font-weight:500;margin-top:12px}}
  .meta{{display:flex;justify-content:space-between;font-size:13px;color:#94a3b8;margin-bottom:16px;padding:0 4px}}
  .footer{{text-align:center;margin-top:32px;font-size:12px;color:#64748b}}
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1><span>Jolkr</span> Status</h1>
    <div class="badge" style="background:{badge_bg};color:{badge_color}">
      <span style="font-size:16px">●</span> {badge_text}
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
</html>"#
    )
}
