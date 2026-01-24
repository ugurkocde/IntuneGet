'use client';

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';

interface SuccessRateChartProps {
  completed: number;
  failed: number;
  pending: number;
}

const COLORS = {
  completed: '#22c55e',
  failed: '#ef4444',
  pending: '#eab308',
};

export function SuccessRateChart({ completed, failed, pending }: SuccessRateChartProps) {
  const data = [
    { name: 'Completed', value: completed, color: COLORS.completed },
    { name: 'Failed', value: failed, color: COLORS.failed },
    { name: 'Pending', value: pending, color: COLORS.pending },
  ].filter((item) => item.value > 0);

  const total = completed + failed + pending;

  if (total === 0) {
    return (
      <div className="h-[300px] flex items-center justify-center text-slate-400">
        No deployment data available
      </div>
    );
  }

  const successRate = Math.round((completed / Math.max(completed + failed, 1)) * 100);

  return (
    <div className="h-[300px] relative">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={100}
            paddingAngle={2}
            dataKey="value"
          >
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              backgroundColor: '#1e293b',
              border: '1px solid #334155',
              borderRadius: '8px',
              color: '#f8fafc',
            }}
            formatter={(value, name) => [value, name]}
          />
          <Legend
            verticalAlign="bottom"
            height={36}
            formatter={(value) => <span className="text-slate-300">{value}</span>}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="text-center -mt-8">
          <p className="text-3xl font-bold text-white">{successRate}%</p>
          <p className="text-sm text-slate-400">Success Rate</p>
        </div>
      </div>
    </div>
  );
}
