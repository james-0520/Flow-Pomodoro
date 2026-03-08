import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { fetchLogSessions, logSession, logSnapshot } from "../../services/logService";
import type { Session } from "../../types";

const sampleSession: Session = {
  id: "abc",
  startTime: "2024-01-01T00:00:00.000Z",
  endTime: "2024-01-01T00:10:00.000Z",
  duration: 600,
  type: "FLOW",
};

const originalFetch = globalThis.fetch;
const originalWarn = console.warn;

beforeEach(() => {
  console.warn = () => {};
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  console.warn = originalWarn;
  vi.restoreAllMocks();
});

test("fetchLogSessions returns sessions when API succeeds", async () => {
  globalThis.fetch = (async () =>
    ({
      ok: true,
      json: async () => ({ sessions: [sampleSession] }),
    }) as Response) as typeof fetch;

  const result = await fetchLogSessions();
  expect(result).toEqual([sampleSession]);
});

test("fetchLogSessions returns empty array when payload shape is unexpected", async () => {
  globalThis.fetch = (async () =>
    ({
      ok: true,
      json: async () => ({ value: 123 }),
    }) as Response) as typeof fetch;

  const result = await fetchLogSessions();
  expect(result).toEqual([]);
});

test("fetchLogSessions returns null when response is not ok", async () => {
  globalThis.fetch = (async () =>
    ({
      ok: false,
      json: async () => ({}),
    }) as Response) as typeof fetch;

  const result = await fetchLogSessions();
  expect(result).toBeNull();
});

test("fetchLogSessions returns null when fetch throws", async () => {
  let warned = false;
  console.warn = () => {
    warned = true;
  };
  globalThis.fetch = (async () => {
    throw new Error("network failure");
  }) as typeof fetch;

  const result = await fetchLogSessions();
  expect(result).toBeNull();
  expect(warned).toBe(true);
});

test("logSession posts to /session endpoint", async () => {
  const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ input, init });
    return {} as Response;
  }) as typeof fetch;

  await logSession(sampleSession);

  expect(calls.length).toBe(1);
  expect(calls[0].input).toBe("/api/log/session");
  expect(calls[0].init?.method).toBe("POST");
  expect(calls[0].init?.headers && (calls[0].init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  expect(calls[0].init?.body).toBe(JSON.stringify(sampleSession));
});

test("logSnapshot posts to /snapshot endpoint", async () => {
  const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ input, init });
    return {} as Response;
  }) as typeof fetch;

  await logSnapshot(sampleSession);

  expect(calls.length).toBe(1);
  expect(calls[0].input).toBe("/api/log/snapshot");
});

test("log helpers swallow write failures", async () => {
  let warned = false;
  console.warn = () => {
    warned = true;
  };
  globalThis.fetch = (async () => {
    throw new Error("write failure");
  }) as typeof fetch;

  await logSession(sampleSession);
  expect(warned).toBe(true);
});
