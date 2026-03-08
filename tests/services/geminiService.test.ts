import { beforeEach, expect, test, vi } from "vitest";
import type { Session } from "../../types";

const mockState = vi.hoisted(() => ({
  generateContentImpl: (async () => ({ text: "{}" })) as (args: any) => Promise<any>,
  lastConfig: undefined as any,
  lastArgs: undefined as any,
}));

vi.mock("@google/genai", () => {
  class FakeGoogleGenAI {
    models = {
      generateContent: async (args: any) => {
        mockState.lastArgs = args;
        return mockState.generateContentImpl(args);
      },
    };

    constructor(config: unknown) {
      mockState.lastConfig = config;
    }
  }

  return {
    GoogleGenAI: FakeGoogleGenAI,
    Type: {
      OBJECT: "OBJECT",
      STRING: "STRING",
      NUMBER: "NUMBER",
    },
  };
});

import { analyzeStudySessions, DEFAULT_GEMINI_MODEL } from "../../services/geminiService";

const sampleSessions: Session[] = [
  {
    id: "s1",
    startTime: "2024-01-01T00:00:00.000Z",
    endTime: "2024-01-01T00:30:00.000Z",
    duration: 1800,
    type: "FLOW",
  },
];

beforeEach(() => {
  mockState.generateContentImpl = async () => ({ text: "{}" });
  mockState.lastConfig = undefined;
  mockState.lastArgs = undefined;
});

test("analyzeStudySessions validates apiKey and model input", async () => {
  await expect(analyzeStudySessions(sampleSessions, { apiKey: "   " })).rejects.toThrow(
    /請先輸入 Gemini API key/
  );
  await expect(analyzeStudySessions(sampleSessions, { apiKey: "k", model: " " })).rejects.toThrow(
    /請先輸入要使用的模型名稱/
  );
});

test("analyzeStudySessions uses trimmed options and normalizes response", async () => {
  mockState.generateContentImpl = async () => ({
    text: JSON.stringify({
      summary: "great work",
      recommendation: "keep going",
      focusScore: 101.7,
      bestTimeOfDay: "morning",
    }),
  });

  const result = await analyzeStudySessions(sampleSessions, { apiKey: " key " });
  expect(result.focusScore).toBe(100);
  expect(result.summary).toBe("great work");
  expect(result.recommendation).toBe("keep going");
  expect(result.bestTimeOfDay).toBe("morning");
  expect(DEFAULT_GEMINI_MODEL).toBe("gemini-2.5-flash");
  expect(mockState.lastConfig).toEqual({ apiKey: "key" });
  expect(mockState.lastArgs.model).toBe(DEFAULT_GEMINI_MODEL);
  expect(mockState.lastArgs.contents).toMatch(/Analyze these study sessions/);
});

test("analyzeStudySessions handles empty model response and malformed payload formats", async () => {
  mockState.generateContentImpl = async () => ({ text: "   " });
  await expect(analyzeStudySessions(sampleSessions, { apiKey: "k", model: "m" })).rejects.toThrow(
    /模型沒有回傳內容/
  );

  mockState.generateContentImpl = async () => ({ text: "null" });
  await expect(analyzeStudySessions(sampleSessions, { apiKey: "k", model: "m" })).rejects.toThrow(
    /模型回傳格式錯誤/
  );

  mockState.generateContentImpl = async () => ({
    text: JSON.stringify({
      summary: "s",
      recommendation: "r",
      focusScore: "bad",
      bestTimeOfDay: "night",
    }),
  });
  await expect(analyzeStudySessions(sampleSessions, { apiKey: "k", model: "m" })).rejects.toThrow(
    /模型回傳格式不完整/
  );
});

test("analyzeStudySessions maps parse and unknown failures to generic error", async () => {
  mockState.generateContentImpl = async () => ({ text: "{not-json}" });
  await expect(analyzeStudySessions(sampleSessions, { apiKey: "k", model: "m" })).rejects.toThrow(
    /AI 分析失敗/
  );

  mockState.generateContentImpl = async () => {
    throw "plain string failure";
  };
  await expect(analyzeStudySessions(sampleSessions, { apiKey: "k", model: "m" })).rejects.toThrow(
    /AI 分析失敗/
  );
});

test("analyzeStudySessions maps quota/auth/not-found/request/server/network errors", async () => {
  const scenarios = [
    {
      error: { status: "429", message: "quota reached" },
      expected: "此模型已超過使用額度",
    },
    {
      error: "429 RESOURCE_EXHAUSTED",
      expected: "此模型已超過使用額度",
    },
    {
      error: { status: 401, message: "unauthorized" },
      expected: "API 金鑰無效或權限不足",
    },
    {
      error: { status: 403, message: "forbidden" },
      expected: "API 金鑰無效或權限不足",
    },
    {
      error: { status: 404, message: "missing" },
      expected: "找不到指定模型",
    },
    {
      error: new Error("model not found by backend"),
      expected: "找不到指定模型",
    },
    {
      error: { status: 400, message: "bad request" },
      expected: "請求格式錯誤",
    },
    {
      error: { status: 500, message: "server down" },
      expected: "Gemini 服務暫時不可用",
    },
    {
      error: { status: 503, message: "unavailable" },
      expected: "Gemini 服務暫時不可用",
    },
    {
      error: { status: "not-a-number", message: "unknown" },
      expected: "AI 分析失敗",
    },
    {
      error: new Error("Fetch failed"),
      expected: "網路連線失敗",
    },
    {
      error: new Error("Network timeout"),
      expected: "網路連線失敗",
    },
  ];

  for (const item of scenarios) {
    mockState.generateContentImpl = async () => {
      throw item.error;
    };
    await expect(analyzeStudySessions(sampleSessions, { apiKey: "k", model: "m" })).rejects.toThrow(
      new RegExp(item.expected)
    );
  }
});
