import http from "http";
import { mkdir, appendFile } from "fs/promises";
import path from "path";

const PORT = Number(process.env.FLOW_LOG_PORT || 5174);
const LOG_DIR = process.env.FLOW_LOG_DIR || path.join(process.cwd(), "data", "logs");
const LOG_FILE = path.join(LOG_DIR, "flow.log");
const ALLOWED_ORIGIN = process.env.FLOW_LOG_ORIGIN || "http://localhost:3000";

const sendJson = (res, status, payload) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
};

const setCors = (res) => {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
};

const isValidSession = (data) => {
  if (!data || typeof data !== "object") return false;
  return (
    typeof data.id === "string" &&
    typeof data.startTime === "number" &&
    typeof data.endTime === "number" &&
    typeof data.duration === "number" &&
    (data.type === "FLOW" || data.type === "BREAK") &&
    typeof data.date === "string"
  );
};

const server = http.createServer(async (req, res) => {
  setCors(res);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;

  if (req.method !== "POST" || !pathname.startsWith("/api/log/")) {
    return sendJson(res, 404, { ok: false, error: "Not found" });
  }

  let raw = "";
  req.on("data", (chunk) => {
    raw += chunk;
    if (raw.length > 1_000_000) req.destroy();
  });

  req.on("end", async () => {
    let payload;
    try {
      payload = JSON.parse(raw || "{}");
    } catch (err) {
      return sendJson(res, 400, { ok: false, error: "Invalid JSON" });
    }

    if (!isValidSession(payload)) {
      return sendJson(res, 400, { ok: false, error: "Invalid session payload" });
    }

    try {
      await mkdir(LOG_DIR, { recursive: true });
      await appendFile(LOG_FILE, `${JSON.stringify(payload)}\n`, "utf8");
      return sendJson(res, 200, { ok: true });
    } catch (err) {
      console.error("Log write error:", err);
      return sendJson(res, 500, { ok: false, error: "Log write failed" });
    }
  });
});

server.listen(PORT, () => {
  console.log(`Flow log server listening on http://localhost:${PORT}`);
  console.log(`Writing logs to ${LOG_FILE}`);
});
