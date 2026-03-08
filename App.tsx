import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import TimerDisplay from './components/TimerDisplay';
import Button from './components/Button';
import { TimerMode, Session, ProductivityInsight } from './types';
import { toDate, toTimestamp } from './utils/sessionTime';
import { db } from './services/dbService';
import { fetchLogSessions, logSession, logSnapshot } from './services/logService';
import hintSoundUrl from './hint.mp3';

const MAX_BREAK = 3600;
const ACTIVE_TIMER_SAVE_INTERVAL_MS = 5000;
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
const DEFAULT_WEEKLY_GOAL_MINUTES = 600;
const DEFAULT_WEEKLY_START_DAY = 1; // Monday
const WEEKDAY_OPTIONS = [
  { value: 0, label: '週日' },
  { value: 1, label: '週一' },
  { value: 2, label: '週二' },
  { value: 3, label: '週三' },
  { value: 4, label: '週四' },
  { value: 5, label: '週五' },
  { value: 6, label: '週六' },
];
const BACKUP_METADATA_KEYS = [
  'breakRatio',
  'hintVolume',
  'insights',
  'lastFlowDuration',
  'geminiModel',
  'weeklyGoalMinutes',
  'weeklyStartDay'
] as const;

type AppView = 'timer' | 'insights';
type ActiveTimerState = {
  savedMode: TimerMode;
  savedSeconds: number;
  savedStartTime: number;
  savedInitialSeconds: number;
  savedIsPaused: boolean;
};
type BackupMetadataKey = typeof BACKUP_METADATA_KEYS[number];
type BackupMetadata = Partial<Record<BackupMetadataKey, unknown>>;
type BackupPayload = {
  version: 1;
  exportedAt: string;
  sessions: Session[];
  metadata: BackupMetadata;
};
const InsightsPanel = React.lazy(() => import('./components/InsightsPanel'));

const toDayKey = (value: Session['startTime']) => {
  const date = toDate(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const dayKeyToDate = (dayKey: string) => {
  const [year, month, day] = dayKey.split('-').map(Number);
  return new Date(year, month - 1, day);
};

const isValidSessionRecord = (value: unknown): value is Session => {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;

  const isTimeValid = (time: unknown) => {
    if (typeof time === 'number') return Number.isFinite(time);
    if (typeof time === 'string') return !Number.isNaN(Date.parse(time));
    return false;
  };

  return (
    typeof record.id === 'string' &&
    isTimeValid(record.startTime) &&
    isTimeValid(record.endTime) &&
    typeof record.duration === 'number' &&
    Number.isFinite(record.duration) &&
    (record.type === 'FLOW' || record.type === 'BREAK')
  );
};

const normalizeSession = (session: Session): Session => ({
  id: session.id,
  startTime: toTimestamp(session.startTime),
  endTime: toTimestamp(session.endTime),
  duration: Math.max(0, Math.round(session.duration)),
  type: session.type
});

const isInsightRecord = (value: unknown): value is ProductivityInsight => {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.summary === 'string' &&
    typeof record.recommendation === 'string' &&
    typeof record.focusScore === 'number' &&
    Number.isFinite(record.focusScore) &&
    typeof record.bestTimeOfDay === 'string'
  );
};

const App: React.FC = () => {
  const [view, setView] = useState<AppView>('timer');
  const [mode, setMode] = useState<TimerMode>(TimerMode.IDLE);
  const [seconds, setSeconds] = useState(0);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [insights, setInsights] = useState<ProductivityInsight | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [geminiModel, setGeminiModel] = useState(DEFAULT_GEMINI_MODEL);
  const [weeklyGoalMinutes, setWeeklyGoalMinutes] = useState(DEFAULT_WEEKLY_GOAL_MINUTES);
  const [weeklyStartDay, setWeeklyStartDay] = useState(DEFAULT_WEEKLY_START_DAY);
  const [breakRatio, setBreakRatio] = useState(0.2);
  const [hintVolume, setHintVolume] = useState(1);
  const [lastFlowDuration, setLastFlowDuration] = useState<number>(0);
  const [dbReady, setDbReady] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isExportingBackup, setIsExportingBackup] = useState(false);
  const [isImportingBackup, setIsImportingBackup] = useState(false);

  const timerRef = useRef<number | null>(null);
  const logIntervalRef = useRef<number | null>(null);
  const modeRef = useRef<TimerMode>(mode);
  const startTimeRef = useRef<number>(0);
  const initialSecondsRef = useRef<number>(0);
  const focus25NotifiedRef = useRef(false);
  const breakEndNotifiedRef = useRef(false);
  const lastActiveTimerSavedAtRef = useRef(0);
  const lastActiveTimerPayloadRef = useRef<string | null>(null);
  const lastActiveTimerSnapshotRef = useRef<Omit<ActiveTimerState, 'savedSeconds'> | null>(null);
  const backupFileInputRef = useRef<HTMLInputElement | null>(null);

  // 防止初始化期間的副作用執行
  const isInitializing = useRef(true);

  const playHintSound = () => {
    try {
      const audio = new Audio(hintSoundUrl);
      audio.volume = Math.min(1, Math.max(0, hintVolume));
      audio.play().catch(() => { });
    } catch {
      // Ignore audio errors (autoplay restrictions or unsupported format).
    }
  };

  const showDesktopNotification = async (title: string, body: string) => {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') {
      new Notification(title, { body });
      return;
    }
    if (Notification.permission === 'denied') return;
    try {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') new Notification(title, { body });
    } catch {
      // Ignore permission errors.
    }
  };

  const triggerFocusCompleteAlert = () => {
    playHintSound();
    void showDesktopNotification('專注 25 分鐘', '如果累了不妨休息一下。');
  };

  const triggerBreakEndAlert = () => {
    playHintSound();
    void showDesktopNotification('休息時間結束', '該準備下一段專注了。');
  };

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
              await Promise.all(legacySessions.map((session) => db.saveSession(session)));
              localStorage.removeItem('flow_sessions');
            }
          } catch (e) { console.error("Migration error", e); }
        }

        // 批次讀取所有持久化狀態
        const [
          dbSessions,
          logSessions,
          savedInsights,
          savedRatio,
          savedLastDuration,
          savedVolume,
          savedWeeklyGoalMinutes,
          savedWeeklyStartDay,
          activeTimer,
          savedGeminiApiKey,
          savedGeminiModel
        ] = await Promise.all([
          db.getAllSessions(),
          fetchLogSessions(),
          db.getMetadata<ProductivityInsight>('insights'),
          db.getMetadata<number>('breakRatio'),
          db.getMetadata<number>('lastFlowDuration'),
          db.getMetadata<number>('hintVolume'),
          db.getMetadata<number>('weeklyGoalMinutes'),
          db.getMetadata<number>('weeklyStartDay'),
          db.getMetadata<any>('activeTimer'),
          db.getMetadata<string>('geminiApiKey'),
          db.getMetadata<string>('geminiModel')
        ]);

        let allSessions = dbSessions;
        if (logSessions) {
          const dbIds = new Set(dbSessions.map((s) => s.id));
          const logIds = new Set(logSessions.map((s) => s.id));

          const missingInDb = logSessions
            .filter((s) => !dbIds.has(s.id))
            .map((s) => ({
              ...s,
              startTime: toTimestamp(s.startTime),
              endTime: toTimestamp(s.endTime)
            }));

          if (missingInDb.length > 0) {
            await Promise.all(missingInDb.map((session) => db.saveSession(session)));
            allSessions = [...dbSessions, ...missingInDb]
              .sort((a, b) => toTimestamp(b.startTime) - toTimestamp(a.startTime));
          }

          const missingInLog = dbSessions.filter((s) => !logIds.has(s.id));
          if (missingInLog.length > 0) {
            await Promise.all(missingInLog.map((session) => logSession(session)));
          }
        }

        // 建立臨時變數來存放計算結果，避免多次渲染產生的閃爍
        let finalMode = TimerMode.IDLE;
        let finalSeconds = 0;
        let currentRatio = savedRatio || 0.2;

        // 1. 基礎數據設定
        if (allSessions) setSessions(allSessions);
        if (savedInsights) setInsights(savedInsights);
        if (savedRatio) setBreakRatio(currentRatio);
        if (savedLastDuration) setLastFlowDuration(savedLastDuration);
        if (typeof savedVolume === 'number') setHintVolume(savedVolume);
        if (typeof savedWeeklyGoalMinutes === 'number' && savedWeeklyGoalMinutes > 0) {
          setWeeklyGoalMinutes(savedWeeklyGoalMinutes);
        }
        if (typeof savedWeeklyStartDay === 'number' && savedWeeklyStartDay >= 0 && savedWeeklyStartDay <= 6) {
          setWeeklyStartDay(savedWeeklyStartDay);
        }
        if (savedGeminiApiKey) setGeminiApiKey(savedGeminiApiKey);
        if (savedGeminiModel) setGeminiModel(savedGeminiModel);

        // 2. 核心邏輯：決定最終要顯示什麼時間
        if (activeTimer) {
          // 優先級最高：恢復正在進行中的計時
          const { savedMode, savedSeconds, savedStartTime, savedInitialSeconds, savedIsPaused } = activeTimer;
          const now = Date.now();
          const elapsed = Math.floor((now - savedStartTime) / 1000);

          if (savedIsPaused && (savedMode === TimerMode.FLOW || savedMode === TimerMode.BREAK)) {
            finalMode = savedMode;
            finalSeconds = savedSeconds;
            initialSecondsRef.current = savedInitialSeconds || 0;
            if (savedMode === TimerMode.FLOW) {
              startTimeRef.current = Date.now() - savedSeconds * 1000;
            } else {
              startTimeRef.current = Date.now() - ((savedInitialSeconds || 0) - savedSeconds) * 1000;
            }
            setIsPaused(true);
          } else if (savedMode === TimerMode.FLOW) {
            finalMode = TimerMode.FLOW;
            // Fix: Do not add savedSeconds to elapsed. elapsed is calculated from savedStartTime which is the original start time.
            finalSeconds = elapsed;
            startTimeRef.current = savedStartTime;
            startInterval(TimerMode.FLOW, savedStartTime, 0);
            startLogInterval();
            setIsPaused(false);
          } else if (savedMode === TimerMode.BREAK) {
            // Fix: Calculate remaining time based on initial break duration minus elapsed time.
            const remaining = savedInitialSeconds - elapsed;
            if (remaining > 0) {
              finalMode = TimerMode.BREAK;
              finalSeconds = remaining;
              startTimeRef.current = savedStartTime;
              initialSecondsRef.current = savedInitialSeconds;
              startInterval(TimerMode.BREAK, savedStartTime, savedInitialSeconds);
              setIsPaused(false);
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
  useEffect(() => { saveState('hintVolume', hintVolume); }, [hintVolume, saveState]);
  useEffect(() => { saveState('insights', insights); }, [insights, saveState]);
  useEffect(() => { saveState('lastFlowDuration', lastFlowDuration); }, [lastFlowDuration, saveState]);
  useEffect(() => { saveState('weeklyGoalMinutes', weeklyGoalMinutes); }, [weeklyGoalMinutes, saveState]);
  useEffect(() => { saveState('weeklyStartDay', weeklyStartDay); }, [weeklyStartDay, saveState]);
  useEffect(() => { saveState('geminiApiKey', geminiApiKey); }, [geminiApiKey, saveState]);
  useEffect(() => { saveState('geminiModel', geminiModel); }, [geminiModel, saveState]);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  // 同步當前計時進度
  useEffect(() => {
    if (!dbReady || isInitializing.current) return;

    const shouldPersistActiveTimer =
      mode !== TimerMode.IDLE || (mode === TimerMode.IDLE && seconds > 0 && lastFlowDuration === 0);

    if (!shouldPersistActiveTimer) {
      db.setMetadata('activeTimer', null);
      lastActiveTimerSavedAtRef.current = Date.now();
      lastActiveTimerPayloadRef.current = null;
      lastActiveTimerSnapshotRef.current = null;
      return;
    }

    const payload: ActiveTimerState = {
      savedMode: mode,
      savedSeconds: seconds,
      savedStartTime: startTimeRef.current,
      savedInitialSeconds: initialSecondsRef.current,
      savedIsPaused: isPaused
    };
    const serialized = JSON.stringify(payload);

    if (serialized === lastActiveTimerPayloadRef.current) return;

    const snapshot = {
      savedMode: payload.savedMode,
      savedStartTime: payload.savedStartTime,
      savedInitialSeconds: payload.savedInitialSeconds,
      savedIsPaused: payload.savedIsPaused
    };
    const lastSnapshot = lastActiveTimerSnapshotRef.current;
    const hasCriticalChange =
      !lastSnapshot ||
      lastSnapshot.savedMode !== snapshot.savedMode ||
      lastSnapshot.savedStartTime !== snapshot.savedStartTime ||
      lastSnapshot.savedInitialSeconds !== snapshot.savedInitialSeconds ||
      lastSnapshot.savedIsPaused !== snapshot.savedIsPaused;

    const shouldThrottle = !hasCriticalChange && !isPaused && (mode === TimerMode.FLOW || mode === TimerMode.BREAK);
    const now = Date.now();
    if (shouldThrottle && now - lastActiveTimerSavedAtRef.current < ACTIVE_TIMER_SAVE_INTERVAL_MS) return;

    db.setMetadata('activeTimer', payload);
    lastActiveTimerSavedAtRef.current = now;
    lastActiveTimerPayloadRef.current = serialized;
    lastActiveTimerSnapshotRef.current = snapshot;
  }, [mode, seconds, dbReady, lastFlowDuration, isPaused]);

  // 此 Effect 僅處理「手動調整比例」時的動態更新，不再參與初始化
  useEffect(() => {
    if (isInitializing.current || !dbReady) return;

    if (mode === TimerMode.IDLE && seconds > 0 && lastFlowDuration > 0) {
      let suggestedBreak = Math.floor(lastFlowDuration * breakRatio);
      if (suggestedBreak > MAX_BREAK) suggestedBreak = MAX_BREAK;
      setSeconds(suggestedBreak);
      return;
    }

    if (mode === TimerMode.BREAK && lastFlowDuration > 0 && initialSecondsRef.current > 0) {
      let adjustedBreak = Math.floor(lastFlowDuration * breakRatio);
      if (adjustedBreak > MAX_BREAK) adjustedBreak = MAX_BREAK;

      const elapsed = Math.max(0, initialSecondsRef.current - seconds);
      const remaining = adjustedBreak - elapsed;
      initialSecondsRef.current = adjustedBreak;

      if (remaining <= 0) {
        stopTimer();
        setIsPaused(false);
        setMode(TimerMode.IDLE);
        setSeconds(0);
        setLastFlowDuration(0);
        db.setMetadata('activeTimer', null);
        return;
      }

      setSeconds(remaining);
      if (!isPaused) {
        const nextStartTime = Date.now() - elapsed * 1000;
        startTimeRef.current = nextStartTime;
        startInterval(TimerMode.BREAK, nextStartTime, adjustedBreak);
      }
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
        type: 'FLOW'
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
        if (diff >= 25 * 60 && !focus25NotifiedRef.current) {
          focus25NotifiedRef.current = true;
          triggerFocusCompleteAlert();
        }
      } else if (targetMode === TimerMode.BREAK) {
        const remaining = baseSeconds - diff;
        if (remaining <= 0) {
          if (!breakEndNotifiedRef.current) {
            breakEndNotifiedRef.current = true;
            triggerBreakEndAlert();
          }
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
    focus25NotifiedRef.current = false;
    startTimeRef.current = now;
    setIsPaused(false);
    setMode(TimerMode.FLOW);
    setSeconds(0);
    setLastFlowDuration(0);
    startInterval(TimerMode.FLOW, now, 0);
    startLogInterval();
  };

  const endFlow = async () => {
    stopTimer();
    stopLogInterval();
    setIsPaused(false);
    const duration = seconds;
    const newSession: Session = {
      id: Math.random().toString(36).substr(2, 9),
      startTime: startTimeRef.current,
      endTime: Date.now(),
      duration,
      type: 'FLOW'
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
    breakEndNotifiedRef.current = false;
    startTimeRef.current = now;
    initialSecondsRef.current = baseSeconds;
    setIsPaused(false);
    setMode(TimerMode.BREAK);
    startInterval(TimerMode.BREAK, now, baseSeconds);
  };

  const skipBreak = () => {
    stopTimer();
    stopLogInterval();
    setIsPaused(false);
    setMode(TimerMode.IDLE);
    setSeconds(0);
    setLastFlowDuration(0);
    db.setMetadata('activeTimer', null);
  };

  const pauseTimer = () => {
    if (mode === TimerMode.IDLE || isPaused) return;
    stopTimer();
    stopLogInterval();
    setIsPaused(true);
  };

  const resumeTimer = () => {
    if (mode === TimerMode.IDLE || !isPaused) return;
    const now = Date.now();
    if (mode === TimerMode.FLOW) {
      startTimeRef.current = now - seconds * 1000;
      startInterval(TimerMode.FLOW, startTimeRef.current, 0);
      startLogInterval();
    } else if (mode === TimerMode.BREAK) {
      startTimeRef.current = now - (initialSecondsRef.current - seconds) * 1000;
      startInterval(TimerMode.BREAK, startTimeRef.current, initialSecondsRef.current);
    }
    setIsPaused(false);
  };

  const triggerAnalysis = async (dataToAnalyze = sessions) => {
    if (isAnalyzing || dataToAnalyze.length === 0) return;
    setAnalysisError(null);
    setIsAnalyzing(true);

    try {
      const { analyzeStudySessions } = await import('./services/geminiService');
      const result = await analyzeStudySessions(dataToAnalyze, {
        apiKey: geminiApiKey,
        model: geminiModel
      });
      setInsights(result);
    } catch (error) {
      if (error instanceof Error && error.name === 'GeminiAnalysisError') {
        const detail = error as Error & { status?: number; detail?: string };
        setAnalysisError(detail.message);
        console.error('Gemini Analysis Error:', {
          message: detail.message,
          status: detail.status,
          detail: detail.detail
        });
      } else {
        setAnalysisError('AI 分析失敗，請稍後再試');
        console.error('Gemini Analysis Error:', error);
      }
    } finally {
      setIsAnalyzing(false);
    }
  };

  const downloadBackupFile = (filename: string, content: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const collectBackupMetadata = async (): Promise<BackupMetadata> => {
    const entries = await Promise.all(
      BACKUP_METADATA_KEYS.map(async (key) => [key, await db.getMetadata(key)] as const)
    );

    return entries.reduce<BackupMetadata>((acc, [key, value]) => {
      if (value !== undefined && value !== null) acc[key] = value;
      return acc;
    }, {});
  };

  const exportBackupAsJson = async () => {
    if (isExportingBackup) return;
    setIsExportingBackup(true);
    try {
      const [backupSessions, metadata] = await Promise.all([
        db.getAllSessions(),
        collectBackupMetadata()
      ]);
      const payload: BackupPayload = {
        version: 1,
        exportedAt: new Date().toISOString(),
        sessions: backupSessions.map(normalizeSession),
        metadata
      };
      const stamp = payload.exportedAt.replace(/[:.]/g, '-');
      downloadBackupFile(`flow-backup-${stamp}.json`, JSON.stringify(payload, null, 2), 'application/json');
    } catch (error) {
      console.error('Backup export failed:', error);
      window.alert('匯出失敗，請稍後重試。');
    } finally {
      setIsExportingBackup(false);
    }
  };

  const exportBackupAsJsonl = async () => {
    if (isExportingBackup) return;
    setIsExportingBackup(true);
    try {
      const backupSessions = await db.getAllSessions();
      if (backupSessions.length === 0) {
        window.alert('目前沒有可匯出的專注紀錄。');
        return;
      }
      const lines = backupSessions.map((session) => JSON.stringify(normalizeSession(session)));
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      downloadBackupFile(`flow-sessions-${stamp}.jsonl`, `${lines.join('\n')}\n`, 'application/x-ndjson');
    } catch (error) {
      console.error('JSONL export failed:', error);
      window.alert('JSONL 匯出失敗，請稍後重試。');
    } finally {
      setIsExportingBackup(false);
    }
  };

  const parseBackupContent = (content: string): { sessions: Session[]; metadata: BackupMetadata } => {
    const trimmed = content.trim();
    if (!trimmed) throw new Error('備份檔是空的。');

    const parseJsonl = () => {
      const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      if (lines.length === 0) throw new Error('JSONL 內容為空。');
      return lines.map((line, index) => {
        try {
          return JSON.parse(line);
        } catch {
          throw new Error(`JSONL 第 ${index + 1} 行格式錯誤。`);
        }
      });
    };

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed) as unknown;
    } catch {
      return { sessions: parseJsonl() as Session[], metadata: {} };
    }

    if (Array.isArray(parsed)) {
      return { sessions: parsed, metadata: {} };
    }
    if (typeof parsed === 'object' && parsed !== null) {
      const record = parsed as Record<string, unknown>;
      if (!Array.isArray(record.sessions)) {
        throw new Error('JSON 備份缺少 sessions 陣列。');
      }
      const metadata = (typeof record.metadata === 'object' && record.metadata !== null)
        ? record.metadata as BackupMetadata
        : {};
      return { sessions: record.sessions as Session[], metadata };
    }
    throw new Error('不支援的備份格式。');
  };

  const applyRestoredMetadata = (metadata: BackupMetadata) => {
    if (typeof metadata.breakRatio === 'number' && metadata.breakRatio > 0 && metadata.breakRatio <= 1) {
      setBreakRatio(metadata.breakRatio);
    }
    if (typeof metadata.hintVolume === 'number' && metadata.hintVolume >= 0 && metadata.hintVolume <= 1) {
      setHintVolume(metadata.hintVolume);
    }
    if (isInsightRecord(metadata.insights)) {
      setInsights(metadata.insights);
    } else {
      setInsights(null);
    }
    if (typeof metadata.lastFlowDuration === 'number' && metadata.lastFlowDuration >= 0) {
      setLastFlowDuration(Math.round(metadata.lastFlowDuration));
    } else {
      setLastFlowDuration(0);
    }
    if (typeof metadata.geminiModel === 'string' && metadata.geminiModel.trim()) {
      setGeminiModel(metadata.geminiModel);
    } else {
      setGeminiModel(DEFAULT_GEMINI_MODEL);
    }
    if (typeof metadata.weeklyGoalMinutes === 'number' && metadata.weeklyGoalMinutes > 0) {
      setWeeklyGoalMinutes(Math.round(metadata.weeklyGoalMinutes));
    } else {
      setWeeklyGoalMinutes(DEFAULT_WEEKLY_GOAL_MINUTES);
    }
    if (typeof metadata.weeklyStartDay === 'number' && metadata.weeklyStartDay >= 0 && metadata.weeklyStartDay <= 6) {
      setWeeklyStartDay(Math.round(metadata.weeklyStartDay));
    } else {
      setWeeklyStartDay(DEFAULT_WEEKLY_START_DAY);
    }
  };

  const importBackupFile = async (file: File) => {
    if (isImportingBackup) return;
    setIsImportingBackup(true);

    try {
      const content = await file.text();
      const parsed = parseBackupContent(content);
      const normalizedSessions = parsed.sessions.filter(isValidSessionRecord).map(normalizeSession);

      if (normalizedSessions.length === 0) {
        throw new Error('找不到可匯入的有效 Session。');
      }

      if (!window.confirm(`將清除現有資料並還原 ${normalizedSessions.length} 筆紀錄，是否繼續？`)) {
        return;
      }

      const fallbackMetadata: BackupMetadata = {
        breakRatio,
        hintVolume,
        geminiModel,
        weeklyGoalMinutes,
        weeklyStartDay
      };
      const restoredMetadata: BackupMetadata = {
        ...fallbackMetadata,
        ...parsed.metadata,
        insights: parsed.metadata.insights ?? null,
        lastFlowDuration: parsed.metadata.lastFlowDuration ?? 0
      };

      stopTimer();
      stopLogInterval();
      await db.clearAll();
      await Promise.all(normalizedSessions.map((session) => db.saveSession(session)));

      for (const key of BACKUP_METADATA_KEYS) {
        const value = restoredMetadata[key];
        if (value !== undefined) {
          await db.setMetadata(key, value);
        }
      }
      await db.setMetadata('activeTimer', null);

      const restoredSessions = await db.getAllSessions();
      setSessions(restoredSessions);
      applyRestoredMetadata(restoredMetadata);
      setGeminiApiKey('');
      setMode(TimerMode.IDLE);
      setSeconds(0);
      setIsPaused(false);
      setAnalysisError(null);
      setView('timer');
      window.alert(`還原完成，共匯入 ${restoredSessions.length} 筆紀錄。`);
    } catch (error) {
      console.error('Backup import failed:', error);
      const message = error instanceof Error ? error.message : '匯入失敗，請確認檔案格式。';
      window.alert(message);
    } finally {
      setIsImportingBackup(false);
    }
  };

  const handleImportBackupClick = () => {
    backupFileInputRef.current?.click();
  };

  const handleImportBackupFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    void importBackupFile(file);
  };

  const resetData = async () => {
    if (window.confirm("確定要刪除所有紀錄嗎？")) {
      stopTimer();
      stopLogInterval();
      await db.clearAll();
      setSessions([]);
      setInsights(null);
      setAnalysisError(null);
      setGeminiApiKey('');
      setGeminiModel(DEFAULT_GEMINI_MODEL);
      setWeeklyGoalMinutes(DEFAULT_WEEKLY_GOAL_MINUTES);
      setWeeklyStartDay(DEFAULT_WEEKLY_START_DAY);
      setSeconds(0);
      setMode(TimerMode.IDLE);
      setLastFlowDuration(0);
      setIsPaused(false);
    }
  };

  const ratioOptions = [
    { label: '1/3', value: 1 / 3 },
    { label: '1/4', value: 1 / 4 },
    { label: '1/5', value: 1 / 5 },
    { label: '1/6', value: 1 / 6 },
    { label: '1/7', value: 1 / 7 },
  ];

  const habitStats = useMemo(() => {
    const flowDurationByDay = new Map<string, number>();

    sessions.forEach((session) => {
      if (session.type !== 'FLOW') return;
      const dayKey = toDayKey(session.startTime);
      flowDurationByDay.set(dayKey, (flowDurationByDay.get(dayKey) || 0) + session.duration);
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayKey = toDayKey(today.getTime());

    const weekStart = new Date(today);
    const dayOfWeek = weekStart.getDay();
    const offset = (dayOfWeek - weeklyStartDay + 7) % 7;
    weekStart.setDate(weekStart.getDate() - offset);

    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);

    let weekFlowSeconds = 0;
    flowDurationByDay.forEach((duration, dayKey) => {
      const date = dayKeyToDate(dayKey);
      if (date >= weekStart && date < weekEnd) {
        weekFlowSeconds += duration;
      }
    });

    const todayFlowSeconds = flowDurationByDay.get(todayKey) || 0;
    const weekMinutes = Math.round(weekFlowSeconds / 60);
    const todayMinutes = Math.round(todayFlowSeconds / 60);
    const remainingMinutes = Math.max(0, weeklyGoalMinutes - weekMinutes);
    const progress = weeklyGoalMinutes > 0 ? Math.min(100, (weekMinutes / weeklyGoalMinutes) * 100) : 0;

    let streakAnchor: Date | null = new Date(today);
    if (!flowDurationByDay.has(todayKey)) {
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayKey = toDayKey(yesterday.getTime());
      if (flowDurationByDay.has(yesterdayKey)) {
        streakAnchor = yesterday;
      } else {
        streakAnchor = null;
      }
    }

    let streakDays = 0;
    while (streakAnchor) {
      const streakKey = toDayKey(streakAnchor.getTime());
      if (!flowDurationByDay.has(streakKey)) break;
      streakDays += 1;
      const prevDate = new Date(streakAnchor);
      prevDate.setDate(prevDate.getDate() - 1);
      streakAnchor = prevDate;
    }

    return {
      weekMinutes,
      todayMinutes,
      streakDays,
      remainingMinutes,
      progress,
      isGoalReached: weekMinutes >= weeklyGoalMinutes
    };
  }, [sessions, weeklyGoalMinutes, weeklyStartDay]);

  const handleWeeklyGoalChange = (value: number) => {
    if (!Number.isFinite(value)) return;
    const bounded = Math.max(60, Math.min(2400, Math.round(value)));
    setWeeklyGoalMinutes(bounded);
  };

  const handleWeeklyStartDayChange = (value: number) => {
    if (!Number.isFinite(value)) return;
    const bounded = Math.max(0, Math.min(6, Math.round(value)));
    setWeeklyStartDay(bounded);
  };

  const handleBreakRatioPercentChange = (value: number) => {
    if (!Number.isFinite(value)) return;
    const bounded = Math.max(5, Math.min(50, Math.round(value)));
    setBreakRatio(bounded / 100);
  };

  const weeklyStartDayLabel = WEEKDAY_OPTIONS.find((option) => option.value === weeklyStartDay)?.label || '週一';

  const getTimerLabel = () => {
    if (mode === TimerMode.FLOW) return isPaused ? "專注暫停" : "專注中";
    if (mode === TimerMode.BREAK) return isPaused ? "休息暫停" : "休息中";
    if (mode === TimerMode.IDLE) {
      return seconds > 0 ? "建議休息時間" : "準備好專注了嗎？";
    }
    return "Flow Pomodoro";
  };

  const formatDuration = (duration: number) => {
    const hours = Math.floor(duration / 3600);
    const minutes = Math.floor((duration % 3600) / 60);
    const secs = duration % 60;

    if (hours > 0) {
      return `${hours}小時 ${minutes}分 ${secs}秒`;
    }
    return `${minutes}分 ${secs}秒`;
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

        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button
            variant="secondary"
            className="px-4 py-2 text-sm"
            onClick={() => void exportBackupAsJson()}
            disabled={isExportingBackup || isImportingBackup}
            title="匯出完整備份（JSON）"
          >
            匯出 JSON
          </Button>
          <Button
            variant="secondary"
            className="px-4 py-2 text-sm"
            onClick={() => void exportBackupAsJsonl()}
            disabled={isExportingBackup || isImportingBackup}
            title="匯出紀錄清單（JSONL）"
          >
            匯出 JSONL
          </Button>
          <Button
            variant="ghost"
            className="px-4 py-2 text-sm"
            onClick={handleImportBackupClick}
            disabled={isExportingBackup || isImportingBackup}
            title="匯入 JSON/JSONL 備份"
          >
            {isImportingBackup ? '匯入中...' : '匯入備份'}
          </Button>
          <Button variant="danger" className="p-3" onClick={resetData} title="清除所有資料庫紀錄">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </Button>
        </div>
      </nav>

      <input
        ref={backupFileInputRef}
        type="file"
        accept=".json,.jsonl,application/json,application/x-ndjson,text/plain"
        onChange={handleImportBackupFileChange}
        className="hidden"
      />

      <main className="max-w-6xl mx-auto">
        {view === 'timer' ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
            <section className="lg:col-span-6 space-y-12">
              <TimerDisplay seconds={seconds} label={getTimerLabel()} mode={mode} isPaused={isPaused} />

              <div className="flex flex-col gap-4 max-w-md mx-auto">
                {mode === TimerMode.IDLE && (
                  <>
                    {seconds > 0 && (
                      <Button variant="primary" onClick={startBreak} className="w-full py-5 text-xl">開始休息</Button>
                    )}
                    <Button variant="secondary" onClick={startFlow} className={`w-full ${seconds > 0 ? 'py-4' : 'py-5 text-xl'}`}>開始專注</Button>
                  </>
                )}
                {mode === TimerMode.FLOW && (
                  <>
                    <Button variant="secondary" onClick={isPaused ? resumeTimer : pauseTimer} className="w-full py-4">{isPaused ? '繼續專注' : '暫停專注'}</Button>
                    <Button variant="danger" onClick={endFlow} className="w-full py-5 text-xl">結束專注</Button>
                  </>
                )}
                {mode === TimerMode.BREAK && (
                  <>
                    <Button variant="secondary" onClick={isPaused ? resumeTimer : pauseTimer} className="w-full py-4">{isPaused ? '繼續休息' : '暫停休息'}</Button>
                    <Button variant="ghost" onClick={skipBreak} className="w-full py-5 text-xl">跳過休息</Button>
                  </>
                )}

                <div className="glass p-4 rounded-2xl border-sky-500/20 mt-2">
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
                  <div className="mt-3 flex items-center gap-3">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">比例%</span>
                    <input
                      type="number"
                      min={5}
                      max={50}
                      step={1}
                      value={Math.round(breakRatio * 100)}
                      onChange={(e) => handleBreakRatioPercentChange(Number(e.target.value))}
                      className="w-24 rounded-lg bg-slate-900/70 border border-slate-700 px-2 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500/60 focus:border-sky-500"
                    />
                    <span className="text-[11px] text-slate-500">
                      休息時間 = 專注時間 x 比例
                    </span>
                  </div>
                </div>

                <div className="glass p-4 rounded-2xl border-sky-500/20">
                  <div className="flex items-center justify-between mb-3 px-1">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">提示音音量</span>
                    <span className="text-xs font-mono text-sky-400">{Math.round(hintVolume * 100)}%</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={hintVolume}
                      onChange={(e) => setHintVolume(Number(e.target.value))}
                      className="flex-1 accent-sky-500"
                    />
                    <Button
                      variant="secondary"
                      onClick={playHintSound}
                      className="px-3 py-2"
                      title="測試提示音"
                    >
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M7 5v14l12-7-12-7z" />
                      </svg>
                    </Button>
                  </div>
                </div>
              </div>
            </section>

            <section className="lg:col-span-6 space-y-8">
              <div className="glass p-5 rounded-2xl border border-slate-700/80 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-widest text-slate-400">目標與習慣追蹤</p>
                    <p className="text-sm text-slate-300 mt-1">本週 {habitStats.weekMinutes} / {weeklyGoalMinutes} 分鐘（起算：{weeklyStartDayLabel}）</p>
                  </div>
                  <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${habitStats.isGoalReached ? 'bg-emerald-500/20 text-emerald-300' : 'bg-sky-500/20 text-sky-300'}`}>
                    {habitStats.isGoalReached ? '本週已達標' : `距離達標 ${habitStats.remainingMinutes} 分`}
                  </span>
                </div>

                <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all ${habitStats.isGoalReached ? 'bg-emerald-500' : 'bg-sky-500'}`}
                    style={{ width: `${habitStats.progress}%` }}
                  />
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-xl bg-slate-900/60 border border-slate-800 p-3 text-center">
                    <p className="text-[11px] uppercase tracking-widest text-slate-500">今日</p>
                    <p className="text-lg font-bold text-slate-100 mt-1">{habitStats.todayMinutes}m</p>
                  </div>
                  <div className="rounded-xl bg-slate-900/60 border border-slate-800 p-3 text-center">
                    <p className="text-[11px] uppercase tracking-widest text-slate-500">連續天數</p>
                    <p className="text-lg font-bold text-slate-100 mt-1">{habitStats.streakDays} 天</p>
                  </div>
                  <div className="rounded-xl bg-slate-900/60 border border-slate-800 p-3 text-center">
                    <p className="text-[11px] uppercase tracking-widest text-slate-500">達成率</p>
                    <p className="text-lg font-bold text-slate-100 mt-1">{Math.round(habitStats.progress)}%</p>
                  </div>
                </div>

                <label className="block">
                  <span className="text-xs font-bold uppercase tracking-widest text-slate-400">每週目標（分鐘）</span>
                  <input
                    type="number"
                    min={60}
                    max={2400}
                    step={30}
                    value={weeklyGoalMinutes}
                    onChange={(e) => handleWeeklyGoalChange(Number(e.target.value))}
                    className="mt-2 w-full rounded-xl bg-slate-900/70 border border-slate-700 px-3 py-2.5 text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500/60 focus:border-sky-500"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-bold uppercase tracking-widest text-slate-400">每週起算日</span>
                  <select
                    value={weeklyStartDay}
                    onChange={(e) => handleWeeklyStartDayChange(Number(e.target.value))}
                    className="mt-2 w-full rounded-xl bg-slate-900/70 border border-slate-700 px-3 py-2.5 text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500/60 focus:border-sky-500"
                  >
                    {WEEKDAY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="text-xs text-slate-500">每週統計會依你選擇的起算日，計算 FLOW 專注總時數。</p>
              </div>

              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold text-slate-100">歷史專注紀錄</h2>
                <span className="text-xs text-slate-500 uppercase tracking-widest">總計 {sessions.length} 筆</span>
              </div>
              <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
                {sessions.length > 0 ? sessions.slice(0, 20).map((s) => (
                  <div key={s.id} className="glass p-4 rounded-xl flex items-center justify-between border-l-4 border-slate-700 hover:border-sky-400 transition-colors">
                    <div>
                      <p className="text-slate-200 font-medium">{s.type === 'FLOW' ? '深度專注' : '恢復休息'}</p>
                      <p className="text-xs text-slate-400">{toDate(s.startTime).toLocaleDateString()} {toDate(s.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-mono text-slate-100">{formatDuration(s.duration)}</p>
                    </div>
                  </div>
                )) : <div className="text-center p-12 glass border-dashed border-2 border-slate-800 rounded-2xl text-slate-500">資料庫目前為空。</div>}
              </div>
            </section>
          </div>
        ) : (
          <React.Suspense
            fallback={
              <div className="space-y-6 animate-in fade-in duration-300">
                <div className="glass rounded-2xl p-6 border border-slate-700/80">
                  <p className="text-slate-300">正在載入分析模組...</p>
                </div>
              </div>
            }
          >
            <InsightsPanel
              sessions={sessions}
              insights={insights}
              isAnalyzing={isAnalyzing}
              analysisError={analysisError}
              geminiApiKey={geminiApiKey}
              geminiModel={geminiModel}
              defaultGeminiModel={DEFAULT_GEMINI_MODEL}
              onGeminiApiKeyChange={setGeminiApiKey}
              onGeminiModelChange={setGeminiModel}
              onRefreshAnalysis={() => triggerAnalysis()}
            />
          </React.Suspense>
        )}
      </main>
    </div>
  );
};

export default App;
