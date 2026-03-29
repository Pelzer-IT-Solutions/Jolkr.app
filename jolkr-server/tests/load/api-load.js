import http from "k6/http";
import { check, group, sleep } from "k6";

const BASE_URL = __ENV.BASE_URL || "http://localhost";
const TOKEN = __ENV.JWT_TOKEN || "";

const headers = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${TOKEN}`,
};

export const options = {
  scenarios: {
    api_load: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "1m", target: 20 },
        { duration: "3m", target: 20 },
        { duration: "1m", target: 50 },
        { duration: "3m", target: 50 },
        { duration: "1m", target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<800", "p(99)<2000"],
    http_req_failed: ["rate<0.05"],
  },
};

export default function () {
  group("user profile", () => {
    const res = http.get(`${BASE_URL}/api/users/@me`, { headers });
    check(res, {
      "get profile ok": (r) => r.status === 200 || r.status === 401,
    });
  });

  group("list servers", () => {
    const res = http.get(`${BASE_URL}/api/servers`, { headers });
    check(res, {
      "list servers ok": (r) => r.status === 200 || r.status === 401,
    });
  });

  group("list friends", () => {
    const res = http.get(`${BASE_URL}/api/friends`, { headers });
    check(res, {
      "list friends ok": (r) => r.status === 200 || r.status === 401,
    });
  });

  group("list dms", () => {
    const res = http.get(`${BASE_URL}/api/dms`, { headers });
    check(res, {
      "list dms ok": (r) => r.status === 200 || r.status === 401,
    });
  });

  sleep(0.5);
}
