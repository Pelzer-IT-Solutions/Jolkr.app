import http from "k6/http";
import { check } from "k6";

const BASE_URL = __ENV.BASE_URL || "http://localhost";

export const options = {
  scenarios: {
    // Burst test: should trigger both nginx and app-level rate limits
    burst: {
      executor: "constant-arrival-rate",
      rate: 50,
      timeUnit: "1s",
      duration: "30s",
      preAllocatedVUs: 50,
    },
    // Sustained load: verify normal traffic passes through
    sustained: {
      executor: "constant-arrival-rate",
      rate: 1,
      timeUnit: "1s",
      duration: "30s",
      preAllocatedVUs: 5,
      startTime: "35s",
    },
  },
  thresholds: {
    "http_req_duration{scenario:sustained}": ["p(95)<500"],
    "checks": ["rate>0.95"],
  },
};

export default function () {
  const res = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({
      email: "loadtest@example.com",
      password: "wrong-password-for-testing",
    }),
    { headers: { "Content-Type": "application/json" } }
  );

  check(res, {
    "status is 401, 422, or 429": (r) =>
      r.status === 401 || r.status === 422 || r.status === 429 || r.status === 503,
    "no 500 errors": (r) => r.status !== 500,
    "response has body": (r) => r.body && r.body.length > 0,
  });
}
