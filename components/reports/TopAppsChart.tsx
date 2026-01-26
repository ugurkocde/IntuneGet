'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

interface TopApp {
  wingetId: string;
  displayName: string;
  publisher: string;
  count: number;
}

interface TopAppsChartProps {
  data: TopApp[];
}

export function TopAppsChart({ data }: TopAppsChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="h-[300px] flex items-center justify-center text-slate-400">
        No app deployment data available
      </div>
    );
  }

  // Truncate long names
  const formattedData = data.map((item) => ({
    ...item,
    shortName:
      item.displayName.length > 20
        ? item.displayName.slice(0, 20) + '...'
        : item.displayName,
  }));

  return (
    <div className="h-[300px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={formattedData}
          layout="vertical"
          margin={{ top: 5, right: 10, left: 80, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
          <XAxis
            type="number"
            stroke="#94a3b8"
            fontSize={12}
            tickLine={false}
            allowDecimals={false}
          />
          <YAxis
            type="category"
            dataKey="shortName"
            stroke="#94a3b8"
            fontSize={11}
            tickLine={false}
            width={80}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#1e293b',
              border: '1px solid #334155',
              borderRadius: '8px',
              color: '#f8fafc',
            }}
            formatter={(value) => [value, 'Deployments']}
            labelFormatter={(label) => {
              const app = formattedData.find((d) => d.shortName === label);
              return app ? `${app.displayName} (${app.publisher})` : label;
            }}
          />
          <Bar
            dataKey="count"
            fill="#3b82f6"
            radius={[0, 4, 4, 0]}
            maxBarSize={30}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
