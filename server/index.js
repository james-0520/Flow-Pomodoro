import http from "http";
import { mkdir, appendFile, readFile } from "fs/promises";
import path from "path";

const PORT = Number(process.env.FLOW_LOG_PORT || 5174);
const LOG_DIR = process.env.FLOW_LOG_DIR || path.join(process.cwd(), "data", "logs");
const SESSION_LOG_FILE = path.join(LOG_DIR, "flow.log");
const SNAPSHOT_LOG_FILE = path.join(LOG_DIR, "flow.snapshots.log");
const ALLOWED_ORIGIN = process.env.FLOW_LOG_ORIGIN || "http://localhost:3000";

const sendJson = (res, status, payload) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
};

const setCors = (res) => {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
};

const isValidTimeValue = (value) => {
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "string") return false;
  return !Number.isNaN(Date.parse(value));
};

const normalizeTime = (value) => {
  const timestamp = typeof value === "number" ? value : Date.parse(value);
  return formatLocalIso(new Date(timestamp));
};

const formatLocalIso = (date) => {
  const pad = (value, size = 2) => String(value).padStart(size, "0");
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());
  const millis = pad(date.getMilliseconds(), 3);
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absOffset = Math.abs(offsetMinutes);
  const offsetHours = pad(Math.floor(absOffset / 60));
  const offsetMins = pad(absOffset % 60);
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${millis}${sign}${offsetHours}:${offsetMins}`;
};

const normalizeSession = (data) => ({
  id: data.id,
  startTime: normalizeTime(data.startTime),
  endTime: normalizeTime(data.endTime),
  duration: data.duration,
  type: data.type,
});

const isValidSession = (data) => {
  if (!data || typeof data !== "object") return false;
  return (
    typeof data.id === "string" &&
    isValidTimeValue(data.startTime) &&
    isValidTimeValue(data.endTime) &&
    typeof data.duration === "number" &&
    (data.type === "FLOW" || data.type === "BREAK")
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

  if (!pathname.startsWith("/api/log/")) {
    return sendJson(res, 404, { ok: false, error: "Not found" });
  }

  if (req.method === "GET" && pathname === "/api/log/sessions") {
    try {
      const rawLog = await readFile(SESSION_LOG_FILE, "utf8").catch(() => "");
      const sessions = rawLog
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch (err) {
            return null;
          }
        })
        .filter((entry) => entry && isValidSession(entry));
      return sendJson(res, 200, { ok: true, sessions });
    } catch (err) {
      console.error("Log read error:", err);
      return sendJson(res, 500, { ok: false, error: "Log read failed" });
    }
  }

  if (req.method !== "POST") {
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
      const normalized = normalizeSession(payload);
      const targetFile = pathname === "/api/log/snapshot" ? SNAPSHOT_LOG_FILE : SESSION_LOG_FILE;
      await appendFile(targetFile, `${JSON.stringify(normalized)}\n`, "utf8");
      return sendJson(res, 200, { ok: true });
    } catch (err) {
      console.error("Log write error:", err);
      return sendJson(res, 500, { ok: false, error: "Log write failed" });
    }
  });
});

server.listen(PORT, () => {
  console.log(`Flow log server listening on http://localhost:${PORT}`);
  console.log(`Writing session logs to ${SESSION_LOG_FILE}`);
  console.log(`Writing snapshot logs to ${SNAPSHOT_LOG_FILE}`);
});
