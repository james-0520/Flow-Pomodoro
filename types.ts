export enum TimerMode {
  FLOW = 'FLOW', // Positive counting
  BREAK = 'BREAK', // Countdown
  IDLE = 'IDLE'
}

export type SessionTime = string | number;

export interface Session {
  id: string;
  startTime: SessionTime;
  endTime: SessionTime;
  duration: number; // in seconds
  type: 'FLOW' | 'BREAK';
}

export interface ProductivityInsight {
  summary: string;
  recommendation: string;
  focusScore: number;
  bestTimeOfDay: string;
}
