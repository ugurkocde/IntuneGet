'use client';

import { useQuery } from '@tanstack/react-query';
import { useMicrosoftAuth } from './useMicrosoftAuth';

export interface RecentActivityItem {
  id: string;
  type: 'upload' | 'package' | 'error';
  displayName: string;
  description: string;
  timestamp: string;
  status: 'success' | 'pending' | 'failed';
  intuneAppUrl?: string;
}

export interface DashboardStats {
  totalDeployed: number;
  thisMonth: number;
  pending: number;
  failed: number;
  recentActivity: RecentActivityItem[];
}

export interface DailyDeployment {
  date: string;
  completed: number;
  failed: number;
}

export interface TopApp {
  wingetId: string;
  displayName: string;
  publisher: string;
  count: number;
}

export interface RecentFailure {
  id: string;
  wingetId: string;
  displayName: string;
  errorMessage: string;
  createdAt: string;
}

export interface AnalyticsSummary {
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  pendingJobs: number;
  successRate: number;
}

export interface AnalyticsData {
  summary: AnalyticsSummary;
  dailyDeployments: DailyDeployment[];
  topApps: TopApp[];
  recentFailures: RecentFailure[];
  dateRange: {
    start: string;
    end: string;
    days: number;
  };
}

export function useDashboardStats() {
  const { getAccessToken, isAuthenticated } = useMicrosoftAuth();

  const query = useQuery<DashboardStats>({
    queryKey: ['analytics', 'stats'],
    queryFn: async () => {
      const token = await getAccessToken();
      if (!token) {
        throw new Error('Not authenticated');
      }

      const response = await fetch('/api/analytics/stats', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch dashboard stats');
      }

      return response.json();
    },
    enabled: isAuthenticated,
    staleTime: 5 * 1000, // 5 seconds when pending
    // Conditional polling: 5s when pending jobs exist, otherwise 60s
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data && data.pending > 0) {
        return 5 * 1000; // 5 seconds
      }
      return 60 * 1000; // 60 seconds
    },
  });

  return query;
}

export function useAnalytics(days: number = 30) {
  const { getAccessToken, isAuthenticated } = useMicrosoftAuth();

  return useQuery<AnalyticsData>({
    queryKey: ['analytics', 'full', days],
    queryFn: async () => {
      const token = await getAccessToken();
      if (!token) {
        throw new Error('Not authenticated');
      }

      const response = await fetch(`/api/analytics?days=${days}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch analytics data');
      }

      return response.json();
    },
    enabled: isAuthenticated,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

export function useExportAnalytics() {
  const { getAccessToken } = useMicrosoftAuth();

  const exportCSV = async (days: number = 30) => {
    const token = await getAccessToken();
    if (!token) {
      throw new Error('Not authenticated');
    }

    const response = await fetch(`/api/analytics/export?days=${days}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to export data');
    }

    // Get the filename from content-disposition header
    const contentDisposition = response.headers.get('Content-Disposition');
    const filenameMatch = contentDisposition?.match(/filename="(.+)"/);
    const filename = filenameMatch ? filenameMatch[1] : 'export.csv';

    // Create download
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  };

  return { exportCSV };
}
