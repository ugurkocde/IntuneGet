import { SkeletonGrid } from '@/components/dashboard';

export default function DashboardLoading() {
  return (
    <div className="space-y-6">
      <div className="h-10 w-48 bg-black/5 rounded-lg animate-pulse" />
      <SkeletonGrid count={4} columns={4} variant="stat" />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="glass-light rounded-xl p-6 border border-black/5 h-64 animate-pulse" />
        <div className="glass-light rounded-xl p-6 border border-black/5 h-64 animate-pulse" />
      </div>
    </div>
  );
}
