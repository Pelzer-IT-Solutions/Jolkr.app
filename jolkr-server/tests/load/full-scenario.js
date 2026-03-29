import http from "k6/http";
import { check, group, sleep } from "k6";

const BASE_URL = __ENV.BASE_URL || "http://localhost";
const TOKEN = __ENV.JWT_TOKEN || "";

const authHeaders = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${TOKEN}`,
};

const jsonHeaders = {
  "Content-Type": "application/json",
};

export const options = {
  scenarios: {
    mixed_traffic: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "2m", target: 50 }, // ramp up
        { duration: "5m", target: 50 }, // sustain
        { duration: "2m", target: 100 }, // peak
        { duration: "5m", target: 100 }, // sustain peak
        { duration: "1m", target: 0 }, // cool down
      ],
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<800", "p(99)<2000"],
    http_req_failed: ["rate<0.05"],
    "http_req_duration{group:::health}": ["p(95)<200"],
    "http_req_duration{group:::auth}": ["p(95)<500"],
    "http_req_duration{group:::api}": ["p(95)<1000"],
  },
};

export default function () {
  const r = Math.random();

  if (r < 0.1) {
    // 10% — health checks
    group("health", () => {
      const res = http.get(`${BASE_URL}/health`);
      check(res, {
        "health ok": (r) => r.status === 200,
        "has pool stats": (r) => {
          try {
            const body = JSON.parse(r.body);
            return body.pool !== undefined;
          } catch (_) {
            return false;
          }
        },
      });
    });
  } else if (r < 0.2) {
    // 10% — auth attempts (should trigger rate limits under load)
    group("auth", () => {
      const res = http.post(
        `${BASE_URL}/api/auth/login`,
        JSON.stringify({
          email: `loadtest-${__VU}@example.com`,
          password: "test-password",
        }),
        { headers: jsonHeaders }
      );
      check(res, {
        "auth response": (r) =>
          r.status === 200 ||
          r.status === 401 ||
          r.status === 422 ||
          r.status === 429 ||
          r.status === 503,
        "no 500": (r) => r.status !== 500,
      });
    });
  } else {
    // 80% — authenticated API calls
    group("api", () => {
      const endpoints = [
        "/api/users/@me",
        "/api/servers",
        "/api/friends",
        "/api/dms",
        "/api/devices",
      ];
      const endpoint = endpoints[Math.floor(Math.random() * endpoints.length)];
      const res = http.get(`${BASE_URL}${endpoint}`, {
        headers: authHeaders,
      });
      check(res, {
        "api response ok": (r) =>
          r.status === 200 || r.status === 401 || r.status === 429,
        "no 500": (r) => r.status !== 500,
        "has request id": (r) => r.headers["X-Request-Id"] !== undefined,
      });
    });
  }

  sleep(0.2 + Math.random() * 0.8); // 200ms-1s think time
}
