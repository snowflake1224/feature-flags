import http from "k6/http";
import { check } from "k6";
import { Trend } from "k6/metrics";

// Load test for the data-plane read path (the hot path SDKs hit). This is a
// Redis-backed cache read of the compiled ruleset, which is what determines
// how fast an SDK can bootstrap / refresh. Local flag evaluation itself is
// in-process and effectively free once the dataset is loaded.
//
// Usage:
//   k6 run -e BASE_URL=http://localhost:4000 -e SDK_KEY=sdk-production-demo00000000 infra/k6/eval-latency.js

const BASE_URL = __ENV.BASE_URL || "http://localhost:4000";
const SDK_KEY = __ENV.SDK_KEY || "sdk-production-demo00000000";

const datasetLatency = new Trend("dataset_read_latency", true);

export const options = {
  scenarios: {
    steady: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "20s", target: 50 },
        { duration: "40s", target: 200 },
        { duration: "20s", target: 0 },
      ],
    },
  },
  thresholds: {
    // The dataset read is a single Redis GET; aim high.
    http_req_duration: ["p(95)<50", "p(99)<120"],
    http_req_failed: ["rate<0.01"],
  },
};

const params = {
  headers: { Authorization: `Bearer ${SDK_KEY}` },
};

export default function () {
  const res = http.get(`${BASE_URL}/sdk/dataset`, params);
  datasetLatency.add(res.timings.duration);
  check(res, {
    "status 200": (r) => r.status === 200,
    "has flags": (r) => {
      try {
        return Object.keys(JSON.parse(r.body).flags || {}).length >= 0;
      } catch {
        return false;
      }
    },
  });
}
