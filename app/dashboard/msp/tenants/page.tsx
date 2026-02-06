'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  Building2,
  Plus,
  ArrowLeft,
  CheckCircle2,
  XCircle,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useMsp } from '@/contexts/MspContext';
import { TenantCard, ConsentUrlDialog } from '@/components/msp';
import { useMicrosoftAuth } from '@/hooks/useMicrosoftAuth';
import { cn } from '@/lib/utils';

export default function MspTenantsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { getAccessToken } = useMicrosoftAuth();
  const {
    isMspUser,
    isLoadingOrganization,
    managedTenants,
    isLoadingTenants,
    selectedTenantId,
    selectTenant,
    refreshTenants,
    removeTenant,
  } = useMsp();

  const [notification, setNotification] = useState<{ type: 'success' | 'error' | 'warning'; message: string } | null>(null);
  const [removingTenantId, setRemovingTenantId] = useState<string | null>(null);
  const [consentUrlDialog, setConsentUrlDialog] = useState<{ isOpen: boolean; url: string; tenantName: string }>({
    isOpen: false,
    url: '',
    tenantName: '',
  });

  // Check for URL params (consent callback results)
  useEffect(() => {
    const success = searchParams.get('success');
    const error = searchParams.get('error');
    const warning = searchParams.get('warning');
    const message = searchParams.get('message');

    if (success) {
      setNotification({
        type: 'success',
        message: success === 'consent_granted'
          ? 'Customer consent granted successfully!'
          : message || 'Operation completed successfully',
      });
      // Refresh tenants list to show updated status
      refreshTenants();
      // Clear params
      router.replace('/dashboard/msp/tenants', { scroll: false });
    } else if (warning) {
      setNotification({
        type: 'warning',
        message: message || 'Action completed with warnings',
      });
      // Refresh tenants list to show updated status
      refreshTenants();
      // Clear params
      router.replace('/dashboard/msp/tenants', { scroll: false });
    } else if (error) {
      setNotification({
        type: 'error',
        message: message || 'An error occurred',
      });
      // Clear params
      router.replace('/dashboard/msp/tenants', { scroll: false });
    }
  }, [searchParams, router, refreshTenants]);

  // Clear notification after 5 seconds
  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  // Redirect to setup if not an MSP user
  useEffect(() => {
    if (!isLoadingOrganization && !isMspUser) {
      router.push('/dashboard/msp/setup');
    }
  }, [isLoadingOrganization, isMspUser, router]);

  const handleRemoveTenant = async (tenantRecordId: string) => {
    if (!confirm('Are you sure you want to remove this tenant? They will need to grant consent again to reconnect.')) {
      return;
    }

    setRemovingTenantId(tenantRecordId);
    try {
      await removeTenant(tenantRecordId);
      setNotification({ type: 'success', message: 'Tenant removed successfully' });
    } catch (err) {
      setNotification({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to remove tenant',
      });
    } finally {
      setRemovingTenantId(null);
    }
  };

  const handleGetConsentUrl = async (tenantRecordId: string) => {
    const tenant = managedTenants.find(t => t.id === tenantRecordId);
    if (!tenant) return;

    try {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        setNotification({
          type: 'error',
          message: 'Authentication required. Please sign in again.',
        });
        return;
      }

      const response = await fetch(`/api/msp/tenants/${tenantRecordId}/consent-url`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || data.error || 'Failed to get consent URL');
      }

      const data = await response.json();
      setConsentUrlDialog({
        isOpen: true,
        url: data.consentUrl,
        tenantName: tenant.display_name,
      });
    } catch (err) {
      setNotification({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to get consent URL',
      });
    }
  };

  const closeConsentUrlDialog = () => {
    setConsentUrlDialog({ isOpen: false, url: '', tenantName: '' });
  };

  // Loading state
  if (isLoadingOrganization) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 bg-black/10 rounded animate-pulse" />
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-32 bg-black/5 rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  // Not an MSP user
  if (!isMspUser) {
    return null;
  }

  // Separate active, incomplete, and pending tenants
  const activeTenants = managedTenants.filter(
    t => t.is_active && t.consent_status === 'granted' && t.tenant_id
  );
  const incompleteTenants = managedTenants.filter(
    t => t.is_active && t.consent_status === 'consent_incomplete'
  );
  const pendingTenants = managedTenants.filter(
    t => t.is_active && t.consent_status === 'pending'
  );

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link
        href="/dashboard/msp"
        className="inline-flex items-center gap-2 text-sm text-text-muted hover:text-text-primary transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to MSP Dashboard
      </Link>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Managed Tenants</h1>
          <p className="text-text-muted mt-1">
            {managedTenants.length} tenant{managedTenants.length !== 1 ? 's' : ''} total
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            onClick={refreshTenants}
            disabled={isLoadingTenants}
            className="text-text-secondary hover:text-text-primary"
          >
            <RefreshCw className={cn('w-4 h-4 mr-2', isLoadingTenants && 'animate-spin')} />
            Refresh
          </Button>
          <Link href="/dashboard/msp/tenants/add">
            <Button className="bg-gradient-to-r from-accent-cyan to-accent-violet text-white">
              <Plus className="w-4 h-4 mr-2" />
              Add Customer
            </Button>
          </Link>
        </div>
      </div>

      {/* Notification */}
      {notification && (
        <div className={cn(
          'p-4 rounded-xl flex items-start gap-3',
          notification.type === 'success' && 'bg-green-500/10 border border-green-500/20',
          notification.type === 'warning' && 'bg-yellow-500/10 border border-yellow-500/20',
          notification.type === 'error' && 'bg-red-500/10 border border-red-500/20'
        )}>
          {notification.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />
          ) : notification.type === 'warning' ? (
            <AlertCircle className="w-5 h-5 text-yellow-500 flex-shrink-0" />
          ) : (
            <XCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
          )}
          <p className={cn(
            'text-sm',
            notification.type === 'success' ? 'text-green-400' : notification.type === 'warning' ? 'text-yellow-400' : 'text-red-400'
          )}>
            {notification.message}
          </p>
        </div>
      )}

      {/* Empty state */}
      {!isLoadingTenants && managedTenants.length === 0 && (
        <div className="p-12 rounded-xl bg-black/5 border border-black/10 text-center">
          <Building2 className="w-12 h-12 text-text-muted mx-auto mb-4" />
          <h2 className="text-lg font-medium text-text-primary mb-2">No customer tenants yet</h2>
          <p className="text-text-muted mb-6 max-w-md mx-auto">
            Start managing your customers' Intune tenants by adding them and having their admin grant consent.
          </p>
          <Link href="/dashboard/msp/tenants/add">
            <Button className="bg-gradient-to-r from-accent-cyan to-accent-violet text-white">
              <Plus className="w-4 h-4 mr-2" />
              Add Your First Customer
            </Button>
          </Link>
        </div>
      )}

      {/* Active Tenants */}
      {activeTenants.length > 0 && (
        <div>
          <h2 className="text-sm font-medium text-text-secondary uppercase tracking-wider mb-4">
            Active Tenants ({activeTenants.length})
          </h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {activeTenants.map((tenant) => (
              <TenantCard
                key={tenant.id}
                tenant={tenant}
                isSelected={selectedTenantId === tenant.tenant_id}
                onSelect={selectTenant}
                onRemove={handleRemoveTenant}
              />
            ))}
          </div>
        </div>
      )}

      {/* Incomplete Consent Tenants */}
      {incompleteTenants.length > 0 && (
        <div>
          <h2 className="text-sm font-medium text-text-secondary uppercase tracking-wider mb-4 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-orange-500" />
            Incomplete Permissions ({incompleteTenants.length})
          </h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {incompleteTenants.map((tenant) => (
              <TenantCard
                key={tenant.id}
                tenant={tenant}
                onRemove={handleRemoveTenant}
                onGetConsentUrl={handleGetConsentUrl}
              />
            ))}
          </div>
          <p className="mt-4 text-sm text-orange-400/80">
            These tenants granted consent but are missing Intune permissions (DeviceManagementApps.ReadWrite.All). The customer admin needs to re-grant consent with the correct permissions to enable app deployments. Use the &quot;Get Consent URL&quot; option to get a new consent link.
          </p>
        </div>
      )}

      {/* Pending Tenants */}
      {pendingTenants.length > 0 && (
        <div>
          <h2 className="text-sm font-medium text-text-secondary uppercase tracking-wider mb-4 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-yellow-500" />
            Pending Consent ({pendingTenants.length})
          </h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {pendingTenants.map((tenant) => (
              <TenantCard
                key={tenant.id}
                tenant={tenant}
                onRemove={handleRemoveTenant}
                onGetConsentUrl={handleGetConsentUrl}
              />
            ))}
          </div>
          <p className="mt-4 text-sm text-text-muted">
            These tenants are waiting for their administrator to grant consent. Use the menu on each card to get the consent URL to share with them.
          </p>
        </div>
      )}

      {/* Consent URL Dialog */}
      <ConsentUrlDialog
        isOpen={consentUrlDialog.isOpen}
        onClose={closeConsentUrlDialog}
        consentUrl={consentUrlDialog.url}
        tenantName={consentUrlDialog.tenantName}
      />
    </div>
  );
}
