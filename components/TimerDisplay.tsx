
import React from 'react';

interface TimerDisplayProps {
  seconds: number;
  label: string;
  mode: 'FLOW' | 'BREAK' | 'IDLE';
}

const TimerDisplay: React.FC<TimerDisplayProps> = ({ seconds, label, mode }) => {
  const formatTime = (totalSeconds: number) => {
    const hrs = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    
    return [
      hrs > 0 ? hrs.toString().padStart(2, '0') : null,
      mins.toString().padStart(2, '0'),
      secs.toString().padStart(2, '0')
    ].filter(Boolean).join(':');
  };

  const getModeColor = () => {
    if (mode === 'FLOW') return 'text-sky-400';
    if (mode === 'BREAK') return 'text-emerald-400';
    return 'text-slate-400';
  };

  return (
    <div className="flex flex-col items-center justify-center p-12 glass rounded-3xl w-full max-w-md mx-auto aspect-square relative overflow-hidden">
      {/* Background Pulse Animation */}
      {mode !== 'IDLE' && (
        <div className={`absolute inset-0 opacity-10 animate-pulse ${mode === 'FLOW' ? 'bg-sky-500' : 'bg-emerald-500'}`} />
      )}
      
      <span className={`text-xs uppercase tracking-[0.2em] font-bold mb-4 ${getModeColor()}`}>
        {label}
      </span>
      
      <div className={`text-7xl md:text-8xl font-mono font-medium tracking-tighter ${getModeColor()}`}>
        {formatTime(seconds)}
      </div>

      <div className="mt-8 flex gap-2">
        <div className={`w-2 h-2 rounded-full ${mode === 'FLOW' ? 'bg-sky-500 animate-ping' : 'bg-slate-700'}`} />
        <div className={`w-2 h-2 rounded-full ${mode === 'BREAK' ? 'bg-emerald-500 animate-ping' : 'bg-slate-700'}`} />
      </div>
    </div>
  );
};

export default TimerDisplay;
