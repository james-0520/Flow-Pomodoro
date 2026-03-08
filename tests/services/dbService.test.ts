import { afterEach, expect, test, vi } from "vitest";
import { DBService } from "../../services/dbService";
import type { Session } from "../../types";

type AsyncRequest<T> = {
  result?: T;
  error?: Error;
  onsuccess: ((event: { target: AsyncRequest<T> }) => void) | null;
  onerror: ((event: { target: AsyncRequest<T> }) => void) | null;
};

const makeRequest = <T>(options: { result?: T; error?: Error; fail?: boolean } = {}): AsyncRequest<T> => {
  const request: AsyncRequest<T> = {
    result: options.result,
    error: options.error || new Error("request failed"),
    onsuccess: null,
    onerror: null,
  };
  queueMicrotask(() => {
    if (options.fail) {
      request.onerror?.({ target: request });
    } else {
      request.onsuccess?.({ target: request });
    }
  });
  return request;
};

const sampleSession: Session = {
  id: "s1",
  startTime: 1000,
  endTime: 2000,
  duration: 1000,
  type: "FLOW",
};

const originalIndexedDb = (globalThis as any).indexedDB;

afterEach(() => {
  (globalThis as any).indexedDB = originalIndexedDb;
  vi.restoreAllMocks();
});

test("init creates required stores when DB is first created", async () => {
  const createdStores: string[] = [];
  const createdIndexes: string[] = [];
  const fakeDb = {
    objectStoreNames: { contains: () => false },
    createObjectStore: (name: string) => {
      createdStores.push(name);
      if (name === "sessions") {
        return {
          createIndex: (indexName: string) => {
            createdIndexes.push(indexName);
          },
        };
      }
      return {};
    },
  };
  const openRequest: any = { onupgradeneeded: null, onsuccess: null, onerror: null };
  (globalThis as any).indexedDB = {
    open: () => {
      queueMicrotask(() => {
        openRequest.onupgradeneeded?.({ target: { result: fakeDb } });
        openRequest.onsuccess?.({ target: { result: fakeDb } });
      });
      return openRequest;
    },
  };

  const service = new DBService();
  await service.init();

  expect(createdStores).toEqual(["sessions", "metadata"]);
  expect(createdIndexes).toEqual(["startTime"]);
});

test("init does not recreate stores that already exist", async () => {
  const createdStores: string[] = [];
  const fakeDb = {
    objectStoreNames: { contains: () => true },
    createObjectStore: (name: string) => {
      createdStores.push(name);
      return {};
    },
  };
  const openRequest: any = { onupgradeneeded: null, onsuccess: null, onerror: null };
  (globalThis as any).indexedDB = {
    open: () => {
      queueMicrotask(() => {
        openRequest.onupgradeneeded?.({ target: { result: fakeDb } });
        openRequest.onsuccess?.({ target: { result: fakeDb } });
      });
      return openRequest;
    },
  };

  const service = new DBService();
  await service.init();
  expect(createdStores).toEqual([]);
});

test("init rejects when indexedDB open fails", async () => {
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  const openRequest: any = { onupgradeneeded: null, onsuccess: null, onerror: null };
  const boom = new Error("open failed");
  (globalThis as any).indexedDB = {
    open: () => {
      queueMicrotask(() => {
        openRequest.onerror?.({ target: { error: boom } });
      });
      return openRequest;
    },
  };

  const service = new DBService();
  await expect(service.init()).rejects.toThrow(/open failed/);
  expect(errorSpy).toHaveBeenCalled();
});

test("saveSession rejects when db is not initialized", async () => {
  const service = new DBService();
  await expect(service.saveSession(sampleSession)).rejects.toMatch(/DB not initialized/);
});

test("saveSession writes session in readwrite transaction", async () => {
  const service = new DBService();
  let stored: Session | null = null;
  (service as any).db = {
    transaction: (storeName: string, mode: IDBTransactionMode) => {
      expect(storeName).toBe("sessions");
      expect(mode).toBe("readwrite");
      return {
        objectStore: () => ({
          put: (session: Session) => {
            stored = session;
            return makeRequest();
          },
        }),
      };
    },
  };

  await service.saveSession(sampleSession);
  expect(stored).toEqual(sampleSession);
});

test("saveSession rejects when request errors", async () => {
  const service = new DBService();
  (service as any).db = {
    transaction: () => ({
      objectStore: () => ({
        put: () => makeRequest({ fail: true, error: new Error("put failed") }),
      }),
    }),
  };

  await expect(service.saveSession(sampleSession)).rejects.toThrow(/put failed/);
});

test("getAllSessions returns sessions in reverse chronological order", async () => {
  const service = new DBService();
  const ordered = [
    { ...sampleSession, id: "old", startTime: 1 },
    { ...sampleSession, id: "new", startTime: 2 },
  ];
  (service as any).db = {
    transaction: (storeName: string, mode: IDBTransactionMode) => {
      expect(storeName).toBe("sessions");
      expect(mode).toBe("readonly");
      return {
        objectStore: () => ({
          index: (indexName: string) => {
            expect(indexName).toBe("startTime");
            return {
              getAll: () => makeRequest({ result: ordered }),
            };
          },
        }),
      };
    },
  };

  const result = await service.getAllSessions();
  expect(result.map((s) => s.id)).toEqual(["new", "old"]);
});

test("getAllSessions rejects when db is missing or read fails", async () => {
  const service = new DBService();
  await expect(service.getAllSessions()).rejects.toMatch(/DB not initialized/);

  (service as any).db = {
    transaction: () => ({
      objectStore: () => ({
        index: () => ({
          getAll: () => makeRequest<Session[]>({ fail: true, error: new Error("read failed") }),
        }),
      }),
    }),
  };
  await expect(service.getAllSessions()).rejects.toThrow(/read failed/);
});

test("setMetadata and getMetadata support values and null fallback", async () => {
  const service = new DBService();
  let setArgs: { key: string; value: unknown } | null = null;
  (service as any).db = {
    transaction: (storeName: string, mode: IDBTransactionMode) => {
      if (storeName === "metadata" && mode === "readwrite") {
        return {
          objectStore: () => ({
            put: (value: unknown, key: string) => {
              setArgs = { key, value };
              return makeRequest();
            },
            clear: () => makeRequest(),
          }),
        };
      }
      return {
        objectStore: () => ({
          get: (key: string) => {
            if (key === "missing") return makeRequest({ result: undefined });
            return makeRequest({ result: 42 });
          },
          clear: () => makeRequest(),
        }),
      };
    },
  };

  await service.setMetadata("answer", 42);
  expect(setArgs).toEqual({ key: "answer", value: 42 });
  await expect(service.getMetadata<number>("answer")).resolves.toBe(42);
  await expect(service.getMetadata<number>("missing")).resolves.toBeNull();
});

test("getMetadata rejects on request error", async () => {
  const service = new DBService();
  await expect(service.getMetadata("any")).rejects.toMatch(/DB not initialized/);

  (service as any).db = {
    transaction: () => ({
      objectStore: () => ({
        get: () => makeRequest({ fail: true, error: new Error("get failed") }),
      }),
    }),
  };

  await expect(service.getMetadata("any")).rejects.toThrow(/get failed/);
});

test("clearAll clears sessions and metadata stores", async () => {
  const service = new DBService();
  const clearedStores: string[] = [];
  (service as any).db = {
    transaction: (storeName: string, mode: IDBTransactionMode) => {
      expect(mode).toBe("readwrite");
      return {
        objectStore: () => ({
          clear: () => {
            clearedStores.push(storeName);
            return makeRequest();
          },
        }),
      };
    },
  };

  await service.clearAll();
  expect(clearedStores).toEqual(["sessions", "metadata"]);
});
