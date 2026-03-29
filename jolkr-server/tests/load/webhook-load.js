import http from "k6/http";
import { check } from "k6";

const BASE_URL = __ENV.BASE_URL || "http://localhost";
const WEBHOOK_ID = __ENV.WEBHOOK_ID || "00000000-0000-0000-0000-000000000000";
const WEBHOOK_TOKEN = __ENV.WEBHOOK_TOKEN || "test-token";

export const options = {
  scenarios: {
    // Burst: should trigger webhook rate limit (5/sec per webhook)
    burst: {
      executor: "constant-arrival-rate",
      rate: 20,
      timeUnit: "1s",
      duration: "15s",
      preAllocatedVUs: 20,
    },
    // Sustained: verify normal throughput works
    sustained: {
      executor: "constant-arrival-rate",
      rate: 3,
      timeUnit: "1s",
      duration: "15s",
      preAllocatedVUs: 5,
      startTime: "20s",
    },
  },
  thresholds: {
    "http_req_duration{scenario:sustained}": ["p(95)<1000"],
  },
};

export default function () {
  const res = http.post(
    `${BASE_URL}/api/webhooks/${WEBHOOK_ID}/${WEBHOOK_TOKEN}`,
    JSON.stringify({
      content: "Load test message from k6",
    }),
    { headers: { "Content-Type": "application/json" } }
  );

  check(res, {
    "status is expected": (r) =>
      r.status === 200 || r.status === 404 || r.status === 429 || r.status === 503,
    "no 500 errors": (r) => r.status !== 500,
  });
}
