'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';

interface TenantSuccessRateData {
  tenant_id: string;
  tenant_name: string;
  success_rate: number;
  total_deployments: number;
}

interface TenantSuccessRateChartProps {
  data: TenantSuccessRateData[];
}

function getSuccessRateColor(rate: number): string {
  if (rate >= 90) return '#22c55e'; // Green
  if (rate >= 70) return '#84cc16'; // Lime
  if (rate >= 50) return '#eab308'; // Yellow
  return '#ef4444'; // Red
}

export function TenantSuccessRateChart({ data }: TenantSuccessRateChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="h-[300px] flex items-center justify-center text-text-muted">
        No deployment data available
      </div>
    );
  }

  // Prepare chart data with shortened names
  const chartData = data.slice(0, 10).map((item) => ({
    name: item.tenant_name.length > 15
      ? item.tenant_name.substring(0, 15) + '...'
      : item.tenant_name,
    fullName: item.tenant_name,
    success_rate: item.success_rate,
    total_deployments: item.total_deployments,
  }));

  return (
    <div className="h-[300px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={chartData}
          margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
          layout="horizontal"
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis
            dataKey="name"
            stroke="#94a3b8"
            fontSize={11}
            tickLine={false}
            angle={-45}
            textAnchor="end"
            height={80}
          />
          <YAxis
            stroke="#94a3b8"
            fontSize={12}
            tickLine={false}
            domain={[0, 100]}
            tickFormatter={(value) => `${value}%`}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#1e293b',
              border: '1px solid #334155',
              borderRadius: '8px',
              color: '#f8fafc',
            }}
            labelStyle={{ color: '#94a3b8' }}
            labelFormatter={(_, payload) =>
              payload?.[0]?.payload?.fullName || ''
            }
            formatter={(value, name, props) => [
              `${value}% (${props.payload.total_deployments} deployments)`,
              'Success Rate',
            ]}
          />
          <Bar dataKey="success_rate" radius={[4, 4, 0, 0]}>
            {chartData.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={getSuccessRateColor(entry.success_rate)}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
