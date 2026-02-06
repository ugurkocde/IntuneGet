'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Loader2,
  FileText,
  User,
  Building2,
  Package,
  Shield,
  ChevronLeft,
  ChevronRight,
  Filter,
  RefreshCw,
  Download,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useMicrosoftAuth } from '@/hooks/useMicrosoftAuth';
import type { AuditAction, ResourceType } from '@/lib/audit-logger';

interface AuditLog {
  id: string;
  user_id: string;
  user_email: string;
  action: AuditAction;
  resource_type: ResourceType | null;
  resource_id: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

interface AuditLogFilters {
  action?: string;
  resource_type?: string;
  user_id?: string;
  start_date?: string;
  end_date?: string;
}

const actionLabels: Record<string, { label: string; color: string }> = {
  'tenant.created': { label: 'Tenant Created', color: 'text-green-500 bg-green-500/10' },
  'tenant.removed': { label: 'Tenant Removed', color: 'text-red-500 bg-red-500/10' },
  'tenant.consent_granted': { label: 'Consent Granted', color: 'text-green-500 bg-green-500/10' },
  'tenant.consent_revoked': { label: 'Consent Revoked', color: 'text-orange-500 bg-orange-500/10' },
  'deployment.started': { label: 'Deployment Started', color: 'text-blue-500 bg-blue-500/10' },
  'deployment.completed': { label: 'Deployment Completed', color: 'text-green-500 bg-green-500/10' },
  'deployment.failed': { label: 'Deployment Failed', color: 'text-red-500 bg-red-500/10' },
  'member.invited': { label: 'Member Invited', color: 'text-purple-500 bg-purple-500/10' },
  'member.joined': { label: 'Member Joined', color: 'text-green-500 bg-green-500/10' },
  'member.removed': { label: 'Member Removed', color: 'text-red-500 bg-red-500/10' },
  'member.role_changed': { label: 'Role Changed', color: 'text-yellow-500 bg-yellow-500/10' },
  'organization.updated': { label: 'Org Updated', color: 'text-blue-500 bg-blue-500/10' },
  'batch.deployment_started': { label: 'Batch Deploy Started', color: 'text-purple-500 bg-purple-500/10' },
};

const resourceIcons: Record<string, typeof User> = {
  tenant: Building2,
  member: User,
  invitation: User,
  deployment: Package,
  organization: Shield,
  batch: Package,
};

export function AuditLogTable() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [filters, setFilters] = useState<AuditLogFilters>({});
  const [showFilters, setShowFilters] = useState(false);

  const { getAccessToken, isAuthenticated } = useMicrosoftAuth();

  const fetchLogs = useCallback(async () => {
    if (!isAuthenticated) return;

    setIsLoading(true);

    try {
      const accessToken = await getAccessToken();
      if (!accessToken) return;

      const params = new URLSearchParams({
        page: page.toString(),
        limit: '25',
      });

      if (filters.action) params.set('action', filters.action);
      if (filters.resource_type) params.set('resource_type', filters.resource_type);

      const response = await fetch(`/api/msp/audit-logs?${params}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setLogs(data.logs);
        setTotalPages(data.total_pages);
      }
    } catch (error) {
      console.error('Error fetching audit logs:', error);
    } finally {
      setIsLoading(false);
    }
  }, [getAccessToken, isAuthenticated, page, filters]);

  useEffect(() => {
    if (isAuthenticated) {
      fetchLogs();
    }
  }, [isAuthenticated, fetchLogs]);

  const exportToCsv = useCallback(async () => {
    if (!isAuthenticated) return;

    setIsExporting(true);

    try {
      const accessToken = await getAccessToken();
      if (!accessToken) return;

      // Fetch all logs (up to 1000) for export
      const params = new URLSearchParams({
        page: '1',
        limit: '1000',
      });

      if (filters.action) params.set('action', filters.action);
      if (filters.resource_type) params.set('resource_type', filters.resource_type);

      const response = await fetch(`/api/msp/audit-logs?${params}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        const allLogs: AuditLog[] = data.logs;

        // Build CSV content
        const headers = ['Date', 'Action', 'User', 'Resource Type', 'Resource ID', 'Details'];
        const rows = allLogs.map((log) => {
          const date = new Date(log.created_at).toISOString();
          const actionInfo = getActionInfo(log.action);
          const details = log.details ? JSON.stringify(log.details) : '';
          return [
            date,
            actionInfo.label,
            log.user_email,
            log.resource_type || '',
            log.resource_id || '',
            details.replace(/"/g, '""'), // Escape quotes for CSV
          ];
        });

        const csvContent = [
          headers.join(','),
          ...rows.map((row) => row.map((cell) => `"${cell}"`).join(',')),
        ].join('\n');

        // Download file
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `audit-logs-${new Date().toISOString().split('T')[0]}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }
    } catch (error) {
      console.error('Error exporting audit logs:', error);
    } finally {
      setIsExporting(false);
    }
  }, [getAccessToken, isAuthenticated, filters]);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(date);
  };

  const getActionInfo = (action: string) => {
    return actionLabels[action] || { label: action, color: 'text-gray-500 bg-gray-500/10' };
  };

  const getResourceIcon = (resourceType: string | null) => {
    const Icon = resourceType ? resourceIcons[resourceType] || FileText : FileText;
    return Icon;
  };

  const renderDetails = (log: AuditLog) => {
    if (!log.details) return null;

    const details = log.details;
    const items: string[] = [];

    if (details.display_name) items.push(`"${details.display_name}"`);
    if (details.tenant_name) items.push(`"${details.tenant_name}"`);
    if (details.invited_email) items.push(`${details.invited_email}`);
    if (details.member_email) items.push(`${details.member_email}`);
    if (details.removed_email) items.push(`${details.removed_email}`);
    if (details.winget_id) items.push(`${details.winget_id}`);
    if (details.old_role && details.new_role) {
      items.push(`${details.old_role} -> ${details.new_role}`);
    }
    if (details.role && !details.old_role) items.push(`as ${details.role}`);
    if (details.error) items.push(`Error: ${details.error}`);

    return items.length > 0 ? items.join(' | ') : null;
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-accent-violet/10 flex items-center justify-center">
            <FileText className="w-5 h-5 text-accent-violet" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-text-primary">Audit Logs</h2>
            <p className="text-sm text-text-muted">Track all organization activity</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={exportToCsv}
            disabled={isExporting || logs.length === 0}
            title="Export to CSV"
          >
            {isExporting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Download className="w-4 h-4" />
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
            className={cn(showFilters && 'bg-black/5')}
          >
            <Filter className="w-4 h-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={fetchLogs}>
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Filters */}
      {showFilters && (
        <div className="flex flex-wrap gap-3 p-4 bg-black/5 rounded-xl">
          <select
            value={filters.action || ''}
            onChange={(e) => {
              setFilters({ ...filters, action: e.target.value || undefined });
              setPage(1);
            }}
            className="px-3 py-1.5 bg-bg-elevated border border-black/10 rounded-lg text-sm"
          >
            <option value="">All Actions</option>
            {Object.entries(actionLabels).map(([value, { label }]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>

          <select
            value={filters.resource_type || ''}
            onChange={(e) => {
              setFilters({ ...filters, resource_type: e.target.value || undefined });
              setPage(1);
            }}
            className="px-3 py-1.5 bg-bg-elevated border border-black/10 rounded-lg text-sm"
          >
            <option value="">All Resources</option>
            <option value="tenant">Tenant</option>
            <option value="member">Member</option>
            <option value="deployment">Deployment</option>
            <option value="organization">Organization</option>
          </select>

          {(filters.action || filters.resource_type) && (
            <button
              onClick={() => {
                setFilters({});
                setPage(1);
              }}
              className="text-sm text-accent-cyan hover:underline"
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center p-8">
          <Loader2 className="w-6 h-6 animate-spin text-accent-cyan" />
        </div>
      ) : logs.length === 0 ? (
        <div className="p-8 text-center text-text-muted">
          <FileText className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>No audit logs found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {logs.map((log) => {
            const actionInfo = getActionInfo(log.action);
            const ResourceIcon = getResourceIcon(log.resource_type);
            const details = renderDetails(log);

            return (
              <div
                key={log.id}
                className="flex items-center gap-4 p-4 bg-bg-elevated rounded-xl border border-black/10"
              >
                <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-black/5 flex items-center justify-center">
                  <ResourceIcon className="w-5 h-5 text-text-muted" />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={cn(
                        'px-2 py-0.5 text-xs rounded-full font-medium',
                        actionInfo.color
                      )}
                    >
                      {actionInfo.label}
                    </span>
                    <span className="text-sm text-text-muted">
                      by {log.user_email.split('@')[0]}
                    </span>
                  </div>
                  {details && (
                    <p className="text-sm text-text-secondary mt-1 truncate">
                      {details}
                    </p>
                  )}
                </div>

                <div className="flex-shrink-0 text-right">
                  <p className="text-sm text-text-muted">{formatDate(log.created_at)}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
          >
            <ChevronLeft className="w-4 h-4" />
            Previous
          </Button>
          <span className="text-sm text-text-muted">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
          >
            Next
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

export default AuditLogTable;
