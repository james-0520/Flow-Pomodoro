import { Session } from "../types";

const API_BASE = "/api/log";

async function postSession(kind: "session" | "snapshot", session: Session): Promise<void> {
  try {
    await fetch(`${API_BASE}/${kind}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(session),
    });
  } catch (err) {
    console.warn("Log write failed:", err);
  }
}

export function logSession(session: Session): Promise<void> {
  return postSession("session", session);
}

export function logSnapshot(session: Session): Promise<void> {
  return postSession("snapshot", session);
}
