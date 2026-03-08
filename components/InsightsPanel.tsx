import React from 'react';
import Button from './Button';
import { ProductivityInsight, Session } from '../types';

const Analytics = React.lazy(() => import('./Analytics'));

interface InsightsPanelProps {
  sessions: Session[];
  insights: ProductivityInsight | null;
  isAnalyzing: boolean;
  analysisError: string | null;
  geminiApiKey: string;
  geminiModel: string;
  defaultGeminiModel: string;
  onGeminiApiKeyChange: (value: string) => void;
  onGeminiModelChange: (value: string) => void;
  onRefreshAnalysis: () => void;
}

const InsightsPanel: React.FC<InsightsPanelProps> = ({
  sessions,
  insights,
  isAnalyzing,
  analysisError,
  geminiApiKey,
  geminiModel,
  defaultGeminiModel,
  onGeminiApiKeyChange,
  onGeminiModelChange,
  onRefreshAnalysis
}) => {
  return (
    <div className="space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h2 className="text-4xl font-bold text-slate-100">AI 生產力分析</h2>
            <p className="text-slate-400 mt-2">深入了解您的專注模式與心流指標。</p>
          </div>
          <Button variant="primary" onClick={onRefreshAnalysis} disabled={isAnalyzing || sessions.length === 0} className="px-8">
            {isAnalyzing ? '分析中...' : '重新整理 AI 分析'}
          </Button>
        </div>

        <div className="glass rounded-2xl p-5 border border-slate-700/80 space-y-4">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Gemini 設定</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="space-y-2">
              <span className="block text-sm text-slate-300">API Key</span>
              <input
                type="password"
                value={geminiApiKey}
                onChange={(e) => onGeminiApiKeyChange(e.target.value)}
                placeholder="貼上 Gemini API key"
                autoComplete="off"
                className="w-full rounded-xl bg-slate-900/70 border border-slate-700 px-3 py-2.5 text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500/60 focus:border-sky-500"
              />
            </label>
            <label className="space-y-2">
              <span className="block text-sm text-slate-300">Model</span>
              <input
                type="text"
                value={geminiModel}
                onChange={(e) => onGeminiModelChange(e.target.value)}
                placeholder={defaultGeminiModel}
                className="w-full rounded-xl bg-slate-900/70 border border-slate-700 px-3 py-2.5 text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500/60 focus:border-sky-500"
              />
            </label>
          </div>
          <p className="text-xs text-slate-500">設定會儲存在本機瀏覽器中，不會上傳到伺服器。</p>
        </div>

        {analysisError && (
          <div className="glass rounded-2xl p-4 border-l-4 border-rose-500">
            <p className="text-rose-300 font-semibold">分析失敗</p>
            <p className="text-slate-200 mt-1">{analysisError}</p>
          </div>
        )}
      </div>

      {sessions.length > 0 ? (
        <React.Suspense
          fallback={
            <div className="glass rounded-2xl p-6 border border-slate-700/80">
              <p className="text-slate-300">正在載入圖表...</p>
            </div>
          }
        >
          <Analytics sessions={sessions} insights={insights} />
        </React.Suspense>
      ) : (
        <div className="text-center py-20 glass rounded-3xl">
          <p className="text-slate-400 text-lg">目前尚無數據，請先完成一些計時階段！</p>
        </div>
      )}
    </div>
  );
};

export default InsightsPanel;
