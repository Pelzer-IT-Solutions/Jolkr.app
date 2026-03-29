import ws from "k6/ws";
import { check } from "k6";

const WS_URL = __ENV.WS_URL || "ws://localhost";
const TOKEN = __ENV.JWT_TOKEN || "";

export const options = {
  scenarios: {
    connections: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 50 },
        { duration: "1m", target: 50 },
        { duration: "30s", target: 100 },
        { duration: "1m", target: 100 },
        { duration: "10s", target: 0 },
      ],
    },
  },
  thresholds: {
    ws_connecting: ["p(95)<1000"],
    checks: ["rate>0.90"],
  },
};

export default function () {
  const res = ws.connect(`${WS_URL}/ws`, {}, function (socket) {
    socket.on("open", () => {
      // Send Identify event
      socket.send(JSON.stringify({ type: "Identify", token: TOKEN }));
    });

    socket.on("message", (data) => {
      try {
        const msg = JSON.parse(data);
        if (msg.type === "Ready") {
          // Connection established — send periodic heartbeats
          socket.setInterval(() => {
            socket.send(JSON.stringify({ type: "Heartbeat", seq: 1 }));
          }, 30000);
        }
      } catch (_) {
        // Ignore parse errors
      }
    });

    // Hold connection for 60 seconds then close
    socket.setTimeout(() => {
      socket.close();
    }, 60000);
  });

  check(res, {
    "ws connected": (r) => r && r.status === 101,
  });
}
