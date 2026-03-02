import { GoogleGenAI, Type } from "@google/genai";
import { ProductivityInsight, Session } from "../types";
import { toReadableTime } from "../utils/sessionTime";

export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

interface AnalyzeOptions {
  apiKey: string;
  model?: string;
}

export class GeminiAnalysisError extends Error {
  status?: number;
  detail?: string;

  constructor(message: string, options?: { status?: number; detail?: string }) {
    super(message);
    this.name = "GeminiAnalysisError";
    this.status = options?.status;
    this.detail = options?.detail;
  }
}

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown error";
};

const getErrorStatus = (error: unknown): number | undefined => {
  if (typeof error === "object" && error !== null) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === "number") return status;
    if (typeof status === "string") {
      const parsed = Number(status);
      if (!Number.isNaN(parsed)) return parsed;
    }
  }
  return undefined;
};

const mapGeminiError = (error: unknown): GeminiAnalysisError => {
  if (error instanceof GeminiAnalysisError) return error;

  const status = getErrorStatus(error);
  const detail = getErrorMessage(error);
  const detailText = detail.toLowerCase();

  if (status === 429 || detailText.includes("429") || detailText.includes("resource_exhausted")) {
    return new GeminiAnalysisError("此模型已超過使用額度，請改用其他模型或金鑰", { status, detail });
  }

  if (status === 401 || status === 403) {
    return new GeminiAnalysisError("API 金鑰無效或權限不足，請檢查後重試", { status, detail });
  }

  if (status === 404 || (detailText.includes("model") && detailText.includes("not found"))) {
    return new GeminiAnalysisError("找不到指定模型，請確認 model 名稱是否正確", { status, detail });
  }

  if (status === 400) {
    return new GeminiAnalysisError("請求格式錯誤，請檢查 API key、model 與分析資料格式", { status, detail });
  }

  if (status === 500 || status === 502 || status === 503 || status === 504) {
    return new GeminiAnalysisError("Gemini 服務暫時不可用，請稍後再試", { status, detail });
  }

  if (detailText.includes("fetch") || detailText.includes("network")) {
    return new GeminiAnalysisError("網路連線失敗，請確認網路後再試", { status, detail });
  }

  return new GeminiAnalysisError("AI 分析失敗，請檢查設定後重試", { status, detail });
};

const toInsight = (data: unknown): ProductivityInsight => {
  if (typeof data !== "object" || data === null) {
    throw new GeminiAnalysisError("模型回傳格式錯誤，請更換模型後重試");
  }

  const raw = data as Record<string, unknown>;
  const focusScore = Number(raw.focusScore);

  if (
    typeof raw.summary !== "string" ||
    typeof raw.recommendation !== "string" ||
    Number.isNaN(focusScore) ||
    typeof raw.bestTimeOfDay !== "string"
  ) {
    throw new GeminiAnalysisError("模型回傳格式不完整，請更換模型後重試");
  }

  return {
    summary: raw.summary,
    recommendation: raw.recommendation,
    focusScore: Math.max(0, Math.min(100, Math.round(focusScore))),
    bestTimeOfDay: raw.bestTimeOfDay
  };
};

export const analyzeStudySessions = async (
  sessions: Session[],
  options: AnalyzeOptions
): Promise<ProductivityInsight> => {
  const apiKey = options.apiKey.trim();
  const model = (options.model || DEFAULT_GEMINI_MODEL).trim();

  if (!apiKey) {
    throw new GeminiAnalysisError("請先輸入 Gemini API key");
  }

  if (!model) {
    throw new GeminiAnalysisError("請先輸入要使用的模型名稱");
  }

  const ai = new GoogleGenAI({ apiKey });

  const sessionsSummary = sessions.map(s => ({
    startTime: toReadableTime(s.startTime),
    endTime: toReadableTime(s.endTime),
    duration: s.duration,
    type: s.type
  }));

  const prompt = `Analyze these study sessions from a "Flow Pomodoro" timer. 
  Flow sessions are positive counting (work until flow breaks). 
  Break sessions are countdowns. 
  
  Sessions: ${JSON.stringify(sessionsSummary)}
  
  Please provide a JSON analysis with:
  1. A summary of the productivity trend.
  2. A personalized recommendation to improve focus.
  3. A focus score (0-100) based on session lengths and consistency.
  4. Best time of day for focus based on these sessions.`;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING },
            recommendation: { type: Type.STRING },
            focusScore: { type: Type.NUMBER },
            bestTimeOfDay: { type: Type.STRING }
          },
          required: ["summary", "recommendation", "focusScore", "bestTimeOfDay"]
        }
      }
    });

    const text = response.text?.trim();
    if (!text) {
      throw new GeminiAnalysisError("模型沒有回傳內容，請更換模型後重試");
    }

    return toInsight(JSON.parse(text));
  } catch (error) {
    throw mapGeminiError(error);
  }
};
