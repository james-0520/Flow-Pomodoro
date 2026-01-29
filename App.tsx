
import React, { useState, useEffect, useCallback, useRef } from 'react';
import TimerDisplay from './components/TimerDisplay';
import Button from './components/Button';
import Analytics from './components/Analytics';
import { TimerMode, Session } from './types';
import { analyzeStudySessions } from './services/geminiService';
import { db } from './services/dbService';
import { logSession, logSnapshot } from './services/logService';

const MAX_BREAK = 3600;

type AppView = 'timer' | 'insights';

const App: React.FC = () => {
  const [view, setView] = useState<AppView>('timer');
  const [mode, setMode] = useState<TimerMode>(TimerMode.IDLE);
  const [seconds, setSeconds] = useState(0);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [insights, setInsights] = useState<any>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [breakRatio, setBreakRatio] = useState(0.2);
  const [lastFlowDuration, setLastFlowDuration] = useState<number>(0);
  const [dbReady, setDbReady] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const timerRef = useRef<number | null>(null);
  const logIntervalRef = useRef<number | null>(null);
  const modeRef = useRef<TimerMode>(mode);
  const startTimeRef = useRef<number>(0);
  const initialSecondsRef = useRef<number>(0);

  // 防止初始化期間的副作用執行
  const isInitializing = useRef(true);

  useEffect(() => {
    const initApp = async () => {
      try {
        await db.init();

        // 搬移舊資料
        const legacySessionsStr = localStorage.getItem('flow_sessions');
        if (legacySessionsStr) {
          try {
            const legacySessions: Session[] = JSON.parse(legacySessionsStr);
            if (Array.isArray(legacySessions)) {
              for (const session of legacySessions) await db.saveSession(session);
              localStorage.removeItem('flow_sessions');
            }
          } catch (e) { console.error("Migration error", e); }
        }

        // 批次讀取所有持久化狀態
        const [allSessions, savedInsights, savedRatio, savedLastDuration, activeTimer] = await Promise.all([
          db.getAllSessions(),
          db.getMetadata<any>('insights'),
          db.getMetadata<number>('breakRatio'),
          db.getMetadata<number>('lastFlowDuration'),
          db.getMetadata<any>('activeTimer')
        ]);

        // 建立臨時變數來存放計算結果，避免多次渲染產生的閃爍
        let finalMode = TimerMode.IDLE;
        let finalSeconds = 0;
        let currentRatio = savedRatio || 0.2;

        // 1. 基礎數據設定
        if (allSessions) setSessions(allSessions);
        if (savedInsights) setInsights(savedInsights);
        if (savedRatio) setBreakRatio(currentRatio);
        if (savedLastDuration) setLastFlowDuration(savedLastDuration);

        // 2. 核心邏輯：決定最終要顯示什麼時間
        if (activeTimer) {
          // 優先級最高：恢復正在進行中的計時
          const { savedMode, savedSeconds, savedStartTime, savedInitialSeconds } = activeTimer;
          const now = Date.now();
          const elapsed = Math.floor((now - savedStartTime) / 1000);

          if (savedMode === TimerMode.FLOW) {
            finalMode = TimerMode.FLOW;
            // Fix: Do not add savedSeconds to elapsed. elapsed is calculated from savedStartTime which is the original start time.
            finalSeconds = elapsed;
            startTimeRef.current = savedStartTime;
            startInterval(TimerMode.FLOW, savedStartTime, 0);
            startLogInterval();
          } else if (savedMode === TimerMode.BREAK) {
            // Fix: Calculate remaining time based on initial break duration minus elapsed time.
            const remaining = savedInitialSeconds - elapsed;
            if (remaining > 0) {
              finalMode = TimerMode.BREAK;
              finalSeconds = remaining;
              startTimeRef.current = savedStartTime;
              initialSecondsRef.current = savedInitialSeconds;
              startInterval(TimerMode.BREAK, savedStartTime, savedInitialSeconds);
            }
          }
        } else if (savedLastDuration > 0) {
          // 優先級次之：如果剛結束專注但還沒開始休息，顯示建議休息時間
          let suggested = Math.floor(savedLastDuration * currentRatio);
          finalSeconds = suggested > MAX_BREAK ? MAX_BREAK : suggested;
        }

        // 3. 一次性同步所有狀態
        setMode(finalMode);
        setSeconds(finalSeconds);

        // 4. 解鎖並關閉載入畫面
        setTimeout(() => {
          isInitializing.current = false;
          setDbReady(true);
        }, 50);

      } catch (err) {
        console.error("Startup failed", err);
      }
    };

    initApp();
  }, []);

  // 儲存狀態的邏輯
  const saveState = useCallback(async (key: string, value: any) => {
    if (!dbReady || isInitializing.current) return;
    setIsSaving(true);
    await db.setMetadata(key, value);
    setTimeout(() => setIsSaving(false), 500);
  }, [dbReady]);

  useEffect(() => { saveState('breakRatio', breakRatio); }, [breakRatio, saveState]);
  useEffect(() => { saveState('insights', insights); }, [insights, saveState]);
  useEffect(() => { saveState('lastFlowDuration', lastFlowDuration); }, [lastFlowDuration, saveState]);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  // 同步當前計時進度
  useEffect(() => {
    if (!dbReady || isInitializing.current) return;
    if (mode !== TimerMode.IDLE || (mode === TimerMode.IDLE && seconds > 0 && lastFlowDuration === 0)) {
      // 只有在非 IDLE 或者正在手動調整時間時才儲存 activeTimer
      db.setMetadata('activeTimer', {
        savedMode: mode,
        savedSeconds: seconds,
        savedStartTime: startTimeRef.current,
        savedInitialSeconds: initialSecondsRef.current
      });
    } else if (mode === TimerMode.IDLE && seconds === 0) {
      db.setMetadata('activeTimer', null);
    }
  }, [mode, seconds, dbReady, lastFlowDuration]);

  // 此 Effect 僅處理「手動調整比例」時的動態更新，不再參與初始化
  useEffect(() => {
    if (isInitializing.current || !dbReady) return;

    if (mode === TimerMode.IDLE && seconds > 0 && lastFlowDuration > 0) {
      let suggestedBreak = Math.floor(lastFlowDuration * breakRatio);
      if (suggestedBreak > MAX_BREAK) suggestedBreak = MAX_BREAK;
      setSeconds(suggestedBreak);
    }
  }, [breakRatio]);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const stopLogInterval = useCallback(() => {
    if (logIntervalRef.current) {
      window.clearInterval(logIntervalRef.current);
      logIntervalRef.current = null;
    }
  }, []);

  const startLogInterval = useCallback(() => {
    stopLogInterval();
    logIntervalRef.current = window.setInterval(() => {
      if (modeRef.current !== TimerMode.FLOW) return;
      const snapshotEnd = Date.now();
      const duration = Math.floor((snapshotEnd - startTimeRef.current) / 1000);
      const snapshot: Session = {
        id: `flow_${startTimeRef.current}_${snapshotEnd}`,
        startTime: startTimeRef.current,
        endTime: snapshotEnd,
        duration,
        type: 'FLOW',
        date: new Date(snapshotEnd).toISOString()
      };
      logSnapshot(snapshot);
    }, 5 * 60 * 1000);
  }, [stopLogInterval]);

  useEffect(() => {
    return () => {
      stopTimer();
      stopLogInterval();
    };
  }, [stopTimer, stopLogInterval]);

  const startInterval = (targetMode: TimerMode, startTs: number, baseSeconds: number) => {
    stopTimer();
    timerRef.current = window.setInterval(() => {
      const now = Date.now();
      const diff = Math.floor((now - startTs) / 1000);

      if (targetMode === TimerMode.FLOW) {
        setSeconds(diff);
      } else if (targetMode === TimerMode.BREAK) {
        const remaining = baseSeconds - diff;
        if (remaining <= 0) {
          stopTimer();
          setMode(TimerMode.IDLE);
          setSeconds(0);
          setLastFlowDuration(0);
          db.setMetadata('activeTimer', null);
        } else {
          setSeconds(remaining);
        }
      }
    }, 1000);
  };

  const startFlow = () => {
    const now = Date.now();
    startTimeRef.current = now;
    setMode(TimerMode.FLOW);
    setSeconds(0);
    setLastFlowDuration(0);
    startInterval(TimerMode.FLOW, now, 0);
    startLogInterval();
  };

  const endFlow = async () => {
    stopTimer();
    stopLogInterval();
    const duration = seconds;
    const newSession: Session = {
      id: Math.random().toString(36).substr(2, 9),
      startTime: startTimeRef.current,
      endTime: Date.now(),
      duration,
      type: 'FLOW',
      date: new Date().toISOString()
    };

    setIsSaving(true);
    await db.saveSession(newSession);
    logSession(newSession);
    const updatedSessions = await db.getAllSessions();
    setSessions(updatedSessions);
    setLastFlowDuration(duration);

    let suggestedBreak = Math.floor(duration * breakRatio);
    if (suggestedBreak > MAX_BREAK) suggestedBreak = MAX_BREAK;

    setSeconds(suggestedBreak);
    setMode(TimerMode.IDLE);
    // 結束專注時，activeTimer 應該轉為存儲建議休息時間，或者清空讓 initApp 重新計算
    await db.setMetadata('activeTimer', null);
    setTimeout(() => setIsSaving(false), 500);
  };

  const startBreak = () => {
    const now = Date.now();
    const baseSeconds = seconds;
    startTimeRef.current = now;
    initialSecondsRef.current = baseSeconds;
    setMode(TimerMode.BREAK);
    startInterval(TimerMode.BREAK, now, baseSeconds);
  };

  const skipBreak = () => {
    stopTimer();
    stopLogInterval();
    setMode(TimerMode.IDLE);
    setSeconds(0);
    setLastFlowDuration(0);
    db.setMetadata('activeTimer', null);
  };

  const triggerAnalysis = async (dataToAnalyze = sessions) => {
    if (isAnalyzing || dataToAnalyze.length === 0) return;
    setIsAnalyzing(true);
    const result = await analyzeStudySessions(dataToAnalyze);
    if (result) setInsights(result);
    setIsAnalyzing(false);
  };

  const resetData = async () => {
    if (window.confirm("確定要刪除所有紀錄嗎？")) {
      stopTimer();
      stopLogInterval();
      await db.clearAll();
      setSessions([]);
      setInsights(null);
      setSeconds(0);
      setMode(TimerMode.IDLE);
      setLastFlowDuration(0);
    }
  };

  const ratioOptions = [
    { label: '1/3', value: 1 / 3 },
    { label: '1/4', value: 1 / 4 },
    { label: '1/5', value: 1 / 5 },
    { label: '1/6', value: 1 / 6 },
    { label: '1/7', value: 1 / 7 },
  ];

  const getTimerLabel = () => {
    if (mode === TimerMode.FLOW) return "深層專注中";
    if (mode === TimerMode.BREAK) return "恢復休息中";
    if (mode === TimerMode.IDLE) {
      return seconds > 0 ? "建議休息時間" : "準備好進入心流了嗎？";
    }
    return "Flow Pomodoro";
  };

  if (!dbReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0f172a]">
        <div className="flex flex-col items-center gap-6">
          <div className="relative">
            <div className="w-16 h-16 border-4 border-slate-800 rounded-full"></div>
            <div className="absolute top-0 w-16 h-16 border-4 border-sky-500 border-t-transparent rounded-full animate-spin"></div>
          </div>
          <div className="text-center">
            <p className="text-slate-200 font-bold text-lg tracking-wide">同步心流狀態</p>
            <p className="text-slate-500 text-sm mt-1">正在從資料庫恢復進度...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-20 px-4 md:px-8 animate-in fade-in duration-700">
      <nav className="max-w-6xl mx-auto py-8 flex flex-col md:flex-row items-center justify-between border-b border-slate-800 mb-12 gap-6">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-sky-500 rounded-xl flex items-center justify-center glow-primary">
              <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-sky-400 to-emerald-400 bg-clip-text text-transparent">
              Flow Pomodoro
            </h1>
          </div>

          <div className="flex items-center gap-2 bg-slate-800/50 px-3 py-1.5 rounded-full border border-slate-700">
            <div className={`w-2 h-2 rounded-full ${isSaving ? 'bg-amber-400 animate-pulse' : 'bg-emerald-500'}`}></div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              {isSaving ? '同步中' : '資料已同步'}
            </span>
          </div>
        </div>

        <div className="flex bg-slate-800/50 p-1 rounded-2xl border border-slate-700">
          <button onClick={() => setView('timer')} className={`px-6 py-2 rounded-xl text-sm font-medium transition-all ${view === 'timer' ? 'bg-sky-500 text-white shadow-lg' : 'text-slate-400 hover:text-slate-200'}`}>計時器</button>
          <button onClick={() => setView('insights')} className={`px-6 py-2 rounded-xl text-sm font-medium transition-all ${view === 'insights' ? 'bg-sky-500 text-white shadow-lg' : 'text-slate-400 hover:text-slate-200'}`}>AI 數據分析</button>
        </div>

        <Button variant="danger" className="p-3" onClick={resetData} title="清除所有資料庫紀錄">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </Button>
      </nav>

      <main className="max-w-6xl mx-auto">
        {view === 'timer' ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
            <section className="lg:col-span-6 space-y-12">
              <TimerDisplay seconds={seconds} label={getTimerLabel()} mode={mode} />

              <div className="flex flex-col gap-4 max-w-md mx-auto">
                {mode === TimerMode.IDLE && (
                  <>
                    <div className="glass p-4 rounded-2xl border-sky-500/20 mb-2">
                      <div className="flex items-center justify-between mb-3 px-1">
                        <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">休息比例設定</span>
                        <span className="text-xs font-mono text-sky-400">當前: {ratioOptions.find(o => Math.abs(o.value - breakRatio) < 0.01)?.label || '自定義'}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-[10px] text-slate-500 font-bold whitespace-nowrap">較長</span>
                        <div className="flex flex-1 gap-1.5">
                          {ratioOptions.map((opt) => (
                            <button key={opt.label} onClick={() => setBreakRatio(opt.value)} className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${Math.abs(breakRatio - opt.value) < 0.01 ? 'bg-sky-500 text-white shadow-md' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}>{opt.label}</button>
                          ))}
                        </div>
                        <span className="text-[10px] text-slate-500 font-bold whitespace-nowrap">較短</span>
                      </div>
                    </div>

                    {seconds > 0 && (
                      <Button variant="primary" onClick={startBreak} className="w-full py-5 text-xl">開始休息</Button>
                    )}
                    <Button variant="secondary" onClick={startFlow} className={`w-full ${seconds > 0 ? 'py-4' : 'py-5 text-xl'}`}>進入心流專注</Button>
                  </>
                )}
                {mode === TimerMode.FLOW && <Button variant="danger" onClick={endFlow} className="w-full py-5 text-xl">結束專注</Button>}
                {mode === TimerMode.BREAK && <Button variant="ghost" onClick={skipBreak} className="w-full py-5 text-xl">跳過休息並結束</Button>}
              </div>
            </section>

            <section className="lg:col-span-6 space-y-8">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold text-slate-100">歷史專注紀錄</h2>
                <span className="text-xs text-slate-500 uppercase tracking-widest">總計 {sessions.length} 筆</span>
              </div>
              <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
                {sessions.length > 0 ? sessions.slice(0, 20).map((s) => (
                  <div key={s.id} className="glass p-4 rounded-xl flex items-center justify-between border-l-4 border-slate-700 hover:border-sky-400 transition-colors">
                    <div>
                      <p className="text-slate-200 font-medium">{s.type === 'FLOW' ? '深度專注' : '恢復休息'}</p>
                      <p className="text-xs text-slate-400">{new Date(s.startTime).toLocaleDateString()} {new Date(s.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-mono text-slate-100">{Math.floor(s.duration / 60)}分 {s.duration % 60}秒</p>
                    </div>
                  </div>
                )) : <div className="text-center p-12 glass border-dashed border-2 border-slate-800 rounded-2xl text-slate-500">資料庫目前為空。</div>}
              </div>
            </section>
          </div>
        ) : (
          <div className="space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-4xl font-bold text-slate-100">AI 生產力分析</h2>
                <p className="text-slate-400 mt-2">深入了解您的專注模式與心流指標。</p>
              </div>
              <Button variant="primary" onClick={() => triggerAnalysis()} disabled={isAnalyzing || sessions.length === 0} className="px-8">{isAnalyzing ? "分析中..." : "重新整理 AI 分析"}</Button>
            </div>
            {sessions.length > 0 ? <Analytics sessions={sessions} insights={insights} /> : <div className="text-center py-20 glass rounded-3xl"><p className="text-slate-400 text-lg">目前尚無數據，請先完成一些計時階段！</p></div>}
          </div>
        )}
      </main>
    </div>
  );
};

export default App;
