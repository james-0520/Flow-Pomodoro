import React from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie, Legend
} from 'recharts';
import { ProductivityInsight, Session } from '../types';
import { toDate } from '../utils/sessionTime';

interface AnalyticsProps {
  sessions: Session[];
  insights: ProductivityInsight | null;
}

const Analytics: React.FC<AnalyticsProps> = ({ sessions, insights }) => {
  const { dailyData, typeData, totalFlowMinutes } = React.useMemo(() => {
    const flowGroups = new Map<number, { date: string; duration: number }>();
    let flowTotal = 0;
    let breakTotal = 0;

    sessions.forEach((session) => {
      if (session.type === 'FLOW') {
        flowTotal += session.duration;
        const dateObj = toDate(session.startTime);
        const dayKey = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate()).getTime();
        const current = flowGroups.get(dayKey);
        if (current) {
          current.duration += session.duration;
        } else {
          flowGroups.set(dayKey, { date: dateObj.toLocaleDateString(), duration: session.duration });
        }
      } else if (session.type === 'BREAK') {
        breakTotal += session.duration;
      }
    });

    const nextDailyData = Array.from(flowGroups.entries())
      .sort(([a], [b]) => a - b)
      .slice(-7)
      .map(([, value]) => ({
        date: value.date,
        minutes: Math.round(value.duration / 60)
      }));

    return {
      dailyData: nextDailyData,
      typeData: [
        { name: 'Work', value: flowTotal, color: '#38bdf8' },
        { name: 'Rest', value: breakTotal, color: '#10b981' }
      ],
      totalFlowMinutes: Math.round(flowTotal / 60)
    };
  }, [sessions]);

  if (sessions.length === 0) {
    return (
      <div className="text-center p-12 glass rounded-2xl border-dashed border-2 border-slate-700">
        <p className="text-slate-400">Complete a session to see your focus analytics.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="glass p-6 rounded-2xl">
          <h4 className="text-sm text-slate-400 mb-1">Focus Score</h4>
          <p className="text-3xl font-bold text-sky-400">{insights?.focusScore || '--'}</p>
        </div>
        <div className="glass p-6 rounded-2xl">
          <h4 className="text-sm text-slate-400 mb-1">Total Work</h4>
          <p className="text-3xl font-bold text-emerald-400">
            {totalFlowMinutes}m
          </p>
        </div>
        <div className="glass p-6 rounded-2xl">
          <h4 className="text-sm text-slate-400 mb-1">Peak Period</h4>
          <p className="text-xl font-bold text-amber-400 truncate">{insights?.bestTimeOfDay || '--'}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="glass p-6 rounded-2xl h-[300px]">
          <h3 className="text-lg font-semibold mb-4 text-slate-200">Session Activity (Last 7 Days)</h3>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={dailyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="date" stroke="#94a3b8" fontSize={10} />
              <YAxis stroke="#94a3b8" fontSize={10} />
              <Tooltip 
                contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px' }}
                itemStyle={{ color: '#38bdf8' }}
              />
              <Bar dataKey="minutes" fill="#38bdf8" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="glass p-6 rounded-2xl h-[300px]">
          <h3 className="text-lg font-semibold mb-4 text-slate-200">Work-Rest Ratio</h3>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={typeData}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={80}
                paddingAngle={5}
                dataKey="value"
              >
                {typeData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip 
                contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px' }}
              />
              <Legend verticalAlign="bottom" height={36}/>
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {insights && (
        <div className="glass p-6 rounded-2xl border-l-4 border-sky-500">
          <h3 className="text-lg font-semibold mb-2 flex items-center gap-2">
            <span className="text-sky-400">✨ AI Insights</span>
          </h3>
          <p className="text-slate-300 mb-4 leading-relaxed">{insights.summary}</p>
          <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700">
            <p className="text-sm font-medium text-sky-400 uppercase tracking-wider mb-1">Recommendation</p>
            <p className="text-slate-300 italic">"{insights.recommendation}"</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default Analytics;
