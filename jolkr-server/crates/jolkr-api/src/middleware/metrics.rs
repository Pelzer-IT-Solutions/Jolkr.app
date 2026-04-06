use axum::{
    extract::Request,
    middleware::Next,
    response::Response,
};
use metrics::{counter, histogram};
use std::sync::LazyLock;
use std::time::Instant;

/// Pre-compiled regexes for path normalization (compiled once, not per-request).
static UUID_RE: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(
        r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}",
    )
    .unwrap()
});
static NUMERIC_RE: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r"/\d+(/|$)").unwrap()
});

/// Middleware that records HTTP request metrics (counter + latency histogram).
pub async fn metrics_middleware(request: Request, next: Next) -> Response {
    let method = request.method().to_string();
    let path = request.uri().path().to_string();

    // Normalize path to avoid high-cardinality labels (strip UUIDs / IDs)
    let normalized = normalize_path(&path);

    let start = Instant::now();
    let response = next.run(request).await;
    let duration = start.elapsed().as_secs_f64();
    let status = response.status().as_u16().to_string();

    counter!("http_requests_total", "method" => method.clone(), "path" => normalized.clone(), "status" => status.clone())
        .increment(1);
    histogram!("http_request_duration_seconds", "method" => method, "path" => normalized, "status" => status)
        .record(duration);

    response
}

/// Replace UUID segments and numeric IDs with placeholders to keep cardinality low.
fn normalize_path(path: &str) -> String {
    let s = UUID_RE.replace_all(path, ":id").to_string();
    NUMERIC_RE.replace_all(&s, "/:id$1").to_string()
}
