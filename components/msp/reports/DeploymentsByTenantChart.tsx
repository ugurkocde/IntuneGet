'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

interface DeploymentsByTenantData {
  tenant_id: string;
  tenant_name: string;
  total: number;
  completed: number;
  failed: number;
  pending: number;
}

interface DeploymentsByTenantChartProps {
  data: DeploymentsByTenantData[];
}

export function DeploymentsByTenantChart({ data }: DeploymentsByTenantChartProps) {
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
    completed: item.completed,
    failed: item.failed,
    pending: item.pending,
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
            allowDecimals={false}
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
            formatter={(value, name) => [
              value,
              name === 'completed'
                ? 'Completed'
                : name === 'failed'
                ? 'Failed'
                : 'Pending',
            ]}
          />
          <Legend
            verticalAlign="top"
            height={36}
            formatter={(value) => (
              <span className="text-slate-300 capitalize">{value}</span>
            )}
          />
          <Bar dataKey="completed" stackId="a" fill="#22c55e" />
          <Bar dataKey="failed" stackId="a" fill="#ef4444" />
          <Bar dataKey="pending" stackId="a" fill="#eab308" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
