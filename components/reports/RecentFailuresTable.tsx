'use client';

import { AlertCircle, ExternalLink } from 'lucide-react';

interface RecentFailure {
  id: string;
  wingetId: string;
  displayName: string;
  errorMessage: string;
  createdAt: string;
}

interface RecentFailuresTableProps {
  data: RecentFailure[];
}

export function RecentFailuresTable({ data }: RecentFailuresTableProps) {
  if (!data || data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-text-muted">
        <div className="w-12 h-12 rounded-full bg-status-success/10 flex items-center justify-center mb-3">
          <svg
            className="w-6 h-6 text-status-success"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 13l4 4L19 7"
            />
          </svg>
        </div>
        <p>No recent failures</p>
        <p className="text-sm text-text-muted mt-1">All deployments successful</p>
      </div>
    );
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const truncateError = (error: string, maxLength: number = 100) => {
    if (error.length <= maxLength) return error;
    return error.slice(0, maxLength) + '...';
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px]">
        <thead>
          <tr className="border-b border-overlay/15">
            <th className="text-left py-3 px-4 text-sm font-medium text-text-muted">
              Application
            </th>
            <th className="text-left py-3 px-4 text-sm font-medium text-text-muted">
              Error
            </th>
            <th className="text-left py-3 px-4 text-sm font-medium text-text-muted">
              Time
            </th>
            <th className="text-right py-3 px-4 text-sm font-medium text-text-muted">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {data.map((failure) => (
            <tr
              key={failure.id}
              className="border-b border-overlay/10 hover:bg-bg-elevated/30 transition-colors"
            >
              <td className="py-3 px-4">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-status-error flex-shrink-0" />
                  <div>
                    <p className="text-text-primary text-sm font-medium">
                      {failure.displayName}
                    </p>
                    <p className="text-text-muted text-xs">{failure.wingetId}</p>
                  </div>
                </div>
              </td>
              <td className="py-3 px-4">
                <p
                  className="text-status-error text-sm"
                  title={failure.errorMessage}
                >
                  {truncateError(failure.errorMessage)}
                </p>
              </td>
              <td className="py-3 px-4">
                <p className="text-text-muted text-sm whitespace-nowrap">
                  {formatDate(failure.createdAt)}
                </p>
              </td>
              <td className="py-3 px-4 text-right">
                <a
                  href={`/dashboard/uploads?jobs=${failure.id}`}
                  className="inline-flex items-center gap-1 text-accent-cyan hover:text-accent-cyan-bright text-sm"
                >
                  View
                  <ExternalLink className="w-3 h-3" />
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
