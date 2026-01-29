
export enum TimerMode {
  FLOW = 'FLOW', // Positive counting
  BREAK = 'BREAK', // Countdown
  IDLE = 'IDLE'
}

export interface Session {
  id: string;
  startTime: number;
  endTime: number;
  duration: number; // in seconds
  type: 'FLOW' | 'BREAK';
  date: string;
}

export interface ProductivityInsight {
  summary: string;
  recommendation: string;
  focusScore: number;
}
