'use client';

import { CheckCircle2, AlertCircle, Loader2, RefreshCw, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useMicrosoftAuth } from '@/hooks/useMicrosoftAuth';
import { PermissionErrorType, PermissionStatusType } from '@/hooks/usePermissionStatus';

interface PermissionStatusIndicatorProps {
  status: PermissionStatusType;
  error: PermissionErrorType;
  errorMessage: string | null;
  onRetry: () => void;
  isRetrying: boolean;
}

export function PermissionStatusIndicator({
  status,
  error,
  errorMessage,
  onRetry,
  isRetrying,
}: PermissionStatusIndicatorProps) {
  const { requestAdminConsent } = useMicrosoftAuth();

  if (status === 'unauthenticated') {
    return null;
  }

  if (status === 'checking') {
    return (
      <div className="flex items-center gap-3 p-3 bg-accent-cyan/10 border border-accent-cyan/20 rounded-lg">
        <Loader2 className="w-5 h-5 text-accent-cyan flex-shrink-0 animate-spin" />
        <div className="flex-1">
          <p className="text-accent-cyan text-sm font-medium">
            Verifying Intune permissions...
          </p>
        </div>
      </div>
    );
  }

  if (status === 'verified') {
    return (
      <div className="flex items-center gap-3 p-3 bg-status-success/10 border border-status-success/20 rounded-lg">
        <CheckCircle2 className="w-5 h-5 text-status-success flex-shrink-0" />
        <div className="flex-1">
          <p className="text-status-success text-sm font-medium">
            Ready to deploy
          </p>
          <p className="text-status-success/70 text-xs mt-0.5">
            Intune permissions verified
          </p>
        </div>
      </div>
    );
  }

  // Error states
  if (error === 'consent_not_granted') {
    return (
      <div className="flex items-start gap-3 p-3 bg-status-error/10 border border-status-error/20 rounded-lg">
        <Shield className="w-5 h-5 text-status-error flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="text-status-error text-sm font-medium">
            Admin consent required
          </p>
          <p className="text-status-error/70 text-xs mt-1">
            A Global Administrator must grant consent to deploy packages to Intune.
          </p>
          <div className="flex gap-2 mt-3">
            <Button
              size="sm"
              onClick={requestAdminConsent}
              className="bg-status-error hover:bg-status-error/90 text-white text-xs h-7 px-3"
            >
              Grant Consent
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={onRetry}
              disabled={isRetrying}
              className="border-status-error/30 text-status-error hover:bg-status-error/10 text-xs h-7 px-3"
            >
              {isRetrying ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <>
                  <RefreshCw className="w-3 h-3 mr-1" />
                  Check Again
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (error === 'insufficient_intune_permissions') {
    return (
      <div className="flex items-start gap-3 p-3 bg-status-warning/10 border border-status-warning/20 rounded-lg">
        <AlertCircle className="w-5 h-5 text-status-warning flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="text-status-warning text-sm font-medium">
            Intune permissions missing
          </p>
          <p className="text-status-warning/70 text-xs mt-1">
            The app needs DeviceManagementApps.ReadWrite.All, DeviceManagementManagedDevices.Read.All, and DeviceManagementServiceConfig.ReadWrite.All (for ESP profiles). Please re-grant admin consent.
          </p>
          <div className="flex gap-2 mt-3">
            <Button
              size="sm"
              onClick={requestAdminConsent}
              className="bg-status-warning hover:bg-status-warning/90 text-black text-xs h-7 px-3"
            >
              Re-grant Consent
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={onRetry}
              disabled={isRetrying}
              className="border-status-warning/30 text-status-warning hover:bg-status-warning/10 text-xs h-7 px-3"
            >
              {isRetrying ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <>
                  <RefreshCw className="w-3 h-3 mr-1" />
                  Check Again
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Network error or other errors
  return (
    <div className="flex items-start gap-3 p-3 bg-status-warning/10 border border-status-warning/20 rounded-lg">
      <AlertCircle className="w-5 h-5 text-status-warning flex-shrink-0 mt-0.5" />
      <div className="flex-1">
        <p className="text-status-warning text-sm font-medium">
          Unable to verify permissions
        </p>
        <p className="text-status-warning/70 text-xs mt-1">
          {errorMessage || 'Please check your connection and try again.'}
        </p>
        <Button
          size="sm"
          variant="outline"
          onClick={onRetry}
          disabled={isRetrying}
          className="mt-3 border-status-warning/30 text-status-warning hover:bg-status-warning/10 text-xs h-7 px-3"
        >
          {isRetrying ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <>
              <RefreshCw className="w-3 h-3 mr-1" />
              Retry
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
