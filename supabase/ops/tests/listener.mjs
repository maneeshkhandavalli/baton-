// Stand-in for the deployed worker endpoint during supabase/ops/tests/run.sh. One JSON line per request.
// It verifies the signed dispatch exactly like lib/pipeline/worker-auth.ts and reports whether the signing
// key appeared anywhere in the request (it must not). Never prints the key.
//   /ok     → 200 with route-shaped counts      /busy → 200 with busy: 1
//   /unauth → 401                                /boom → 500
//   /hang   → never answers (timeout)
import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

const [port, key] = [Number(process.argv[2]), process.argv[3]];

// purpose "drain" signs "v1.<s>.<id>"; "retention" signs "v1.<s>.<id>.retention" (lib/pipeline/worker-auth.ts)
function dispatchValid(header, purpose = "drain") {
  const m = /^v1\.(\d{9,11})\.(\d{1,18})\.([0-9a-f]{64})$/.exec(header ?? "");
  if (!m) return false;
  const message = purpose === "drain" ? `v1.${m[1]}.${m[2]}` : `v1.${m[1]}.${m[2]}.${purpose}`;
  const expected = createHmac("sha256", key).update(message).digest("hex");
  const age = Math.floor(Date.now() / 1000) - Number(m[1]);
  return timingSafeEqual(Buffer.from(m[3]), Buffer.from(expected)) && age <= 120 && age >= -30;
}

createServer((req, res) => {
  let body = "";
  req.on("data", (d) => (body += d)).on("end", () => {
    const retention = (req.url ?? "").startsWith("/api/cron/retention");
    const path = retention ? "/retention" : (req.url ?? "").replace(/^\/api\/pipeline\/drain/, "") || "/ok";
    console.log(JSON.stringify({
      path,
      method: req.method,
      dispatchValid: dispatchValid(req.headers["x-baton-dispatch"]),
      retentionValid: dispatchValid(req.headers["x-baton-dispatch"], "retention"),
      hasAuthorization: "authorization" in req.headers,
      keySeen: JSON.stringify(req.headers).includes(key) || body.includes(key),
    }));
    if (path === "/hang") return; // never answer
    if (retention) {
      return res.writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ mode: "live", eligible: 2, protected: 0, claimed: 2, claimSkipped: 0, deleted: 2, failed: 0, due: 0 }));
    }
    if (path === "/unauth") return res.writeHead(401, { "content-type": "application/json" }).end('{"error":"unauthorized"}');
    if (path === "/boom") return res.writeHead(500, { "content-type": "application/json" }).end('{"error":"drain_failed"}');
    const busy = path === "/busy" ? 1 : 0;
    res.writeHead(200, { "content-type": "application/json" })
      .end(JSON.stringify({ claimed: busy ? 0 : 3, succeeded: busy ? 0 : 3, retried: 0, failed: 0, deferred: 0, skipped: 0, lost: 0, busy }));
  });
}).listen(port, "0.0.0.0", () => console.log(JSON.stringify({ listening: port })));
