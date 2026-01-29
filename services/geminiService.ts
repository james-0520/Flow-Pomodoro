
import { GoogleGenAI, Type } from "@google/genai";
import { Session } from "../types";

export const analyzeStudySessions = async (sessions: Session[]): Promise<any> => {
  // Always use a named parameter and direct process.env.API_KEY reference
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const sessionsSummary = sessions.map(s => ({
    date: s.date,
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
    // Correct usage of generateContent with model and contents together
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
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

    // Access the .text property directly as a property (not a method)
    return JSON.parse(response.text || '{}');
  } catch (error) {
    console.error("Gemini Analysis Error:", error);
    return null;
  }
};
