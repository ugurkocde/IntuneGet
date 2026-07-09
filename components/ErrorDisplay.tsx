'use client';

import Link from 'next/link';
import {
  AlertCircle,
  Download,
  Package,
  Upload,
  Key,
  CheckCircle,
  Server,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface ErrorDetails {
  expectedHash?: string;
  actualHash?: string;
  exitCode?: number;
  statusCode?: number;
  url?: string;
  domain?: string;
  tenantId?: string;
  errorMessage?: string;
  size?: number;
  expected?: number;
  retries?: number;
  mirrorsAttempted?: string[];
  uploadState?: string;
  commitState?: string;
  operation?: string;
  output?: string;
}

interface ErrorDisplayProps {
  errorMessage?: string | null;
  errorStage?: string | null;
  errorCategory?: string | null;
  errorCode?: string | null;
  errorDetails?: ErrorDetails | null;
}

const stageConfig: Record<string, { icon: typeof Download; label: string }> = {
  download: { icon: Download, label: 'Download' },
  package: { icon: Package, label: 'Packaging' },
  upload: { icon: Upload, label: 'Upload' },
  authenticate: { icon: Key, label: 'Authentication' },
  finalize: { icon: CheckCircle, label: 'Finalize' },
  duplicate_check: { icon: CheckCircle, label: 'Duplicate Check' },
  unknown: { icon: Server, label: 'Unknown' },
};

const categoryHints: Record<string, { message: string; showReVerify?: boolean }> = {
  permission: {
    message: 'This appears to be a permissions issue. Your Global Administrator may need to grant admin consent with Intune permissions.',
    showReVerify: true,
  },
  network: {
    message: 'This is a network-related error. The download server may be unavailable or rate-limiting requests. You can try again later or package a different version.',
  },
  validation: {
    message: 'The downloaded file did not pass validation. The installer may have been updated since the manifest was created.',
  },
  installer: {
    message: 'There was an issue creating the .intunewin package. This may be due to an unsupported installer format.',
  },
  intune_api: {
    message: 'The Intune API returned an error. This could be a temporary issue with Microsoft services.',
  },
  system: {
    message: 'An unexpected system error occurred. Please try again or contact support if the issue persists.',
  },
  duplicate: {
    message: 'An app with the same name already exists in your Intune tenant. You can view the existing app or force deploy a new copy.',
  },
};

const errorCodeMessages: Record<string, string> = {
  DOWNLOAD_NOT_FOUND: 'The installer URL returned 404 - the file may have been moved or deleted',
  DOWNLOAD_FAILED: 'Failed to download the installer file',
  DOWNLOAD_TIMEOUT: 'Download timed out - the server may be slow or unavailable',
  DOWNLOAD_RATE_LIMITED: 'Rate limited by the download server - try again later',
  DOWNLOAD_CLOUDFLARE: 'Blocked by Cloudflare protection on the download server',
  DOWNLOAD_SOURCEFORGE_FAILED: 'All SourceForge mirror servers failed to respond',
  DOWNLOAD_TOOLS_FAILED: 'Failed to download required packaging tools',
  TOOL_HASH_MISMATCH: 'Packaging tools failed integrity verification',
  DOWNLOAD_INVALID_RESPONSE: 'Received an invalid response instead of the installer file',
  DOWNLOAD_FILE_TOO_SMALL: 'Downloaded file is suspiciously small and may be corrupted',
  INVALID_EXPECTED_HASH: 'The expected SHA256 hash in the manifest is malformed',
  HASH_MISMATCH: 'SHA256 hash mismatch - the installer has been updated and the manifest is out of date',
  PACKAGE_CREATION_FAILED: 'Failed to create the .intunewin package',
  AUTH_FAILED: 'Failed to acquire authentication token',
  AUTH_INVALID_CREDENTIALS: 'Service principal credentials are invalid',
  AUTH_NO_CONSENT: 'Admin consent has not been granted for the required permissions',
  INTUNE_UNAUTHORIZED: 'Microsoft Graph rejected the service principal credentials (401)',
  INTUNE_FORBIDDEN: 'Access denied (403) - missing DeviceManagementApps.ReadWrite.All permission',
  INTUNE_SERVICE_TRANSIENT: 'Intune returned a temporary backend error. A safe retry is recommended.',
  INTUNE_BAD_REQUEST: 'Intune rejected the app or content request. Review the workflow log for the rejected field.',
  INTUNE_API_ERROR: 'The Intune API returned an unexpected error',
  AZURE_STORAGE_URI_FAILED: 'Failed to get Azure Storage URI from Intune',
  AZURE_AUTH_FAILED: 'Azure Storage authentication failed',
  AZURE_UPLOAD_FAILED: 'Failed to upload package to Azure Storage',
  INTUNE_COMMIT_FAILED: 'Failed to commit the uploaded file to Intune',
  WORKFLOW_DISPATCH_FAILED: 'The packaging workflow could not be started. No upload was performed.',
  DUPLICATE_CHECK_FAILED: 'Intune could not confirm whether this app already exists. Retry when Microsoft Graph is available.',
  UNEXPECTED_ERROR: 'An unexpected error occurred during the pipeline',
};

export function ErrorDisplay({
  errorMessage,
  errorStage,
  errorCategory,
  errorCode,
  errorDetails,
}: ErrorDisplayProps) {
  // Fallback to basic display if no structured error data
  if (!errorCode && !errorStage && !errorCategory) {
    return (
      <div className="mt-4 p-4 bg-status-error/[0.07] border border-status-error/15 rounded-xl">
        <div className="flex items-start gap-2">
          <AlertCircle className="w-5 h-5 text-status-error flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="text-status-error/90">{errorMessage || 'Unknown error'}</p>
            {/* Fallback hint for permission-related errors detected from message */}
            {errorMessage && (
              errorMessage.toLowerCase().includes('forbidden') ||
              errorMessage.includes('403') ||
              errorMessage.toLowerCase().includes('unauthorized') ||
              errorMessage.toLowerCase().includes('permission') ||
              errorMessage.toLowerCase().includes('access denied')
            ) && (
              <p className="text-status-warning mt-2">
                This may be a permissions issue. Check that your organization&apos;s Global Administrator has granted admin consent with Intune permissions.
                <Link href="/onboarding" className="text-accent-cyan hover:underline ml-1">
                  Re-verify permissions
                </Link>
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  const stage = stageConfig[errorStage || 'unknown'] || stageConfig.unknown;
  const StageIcon = stage.icon;
  const hint = categoryHints[errorCategory || ''];
  const codeMessage = errorCodeMessages[errorCode || ''];
  const details = errorDetails as ErrorDetails | null;

  return (
    <div className="mt-4 p-4 bg-status-error/[0.07] border border-status-error/15 rounded-xl space-y-3">
      {/* Header with stage and code */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-status-error/20 flex items-center justify-center">
            <StageIcon className="w-4 h-4 text-status-error" />
          </div>
          <div>
            <span className="text-status-error font-medium">
              Failed at: {stage.label}
            </span>
          </div>
        </div>
        {errorCode && (
          <span className="px-2 py-1 bg-status-error/20 border border-status-error/10 text-status-error text-xs font-mono rounded">
            {errorCode}
          </span>
        )}
      </div>

      {/* Main error message */}
      <div className="text-sm text-status-error/90">
        <p>{codeMessage || errorMessage || 'An error occurred'}</p>
      </div>

      {/* Hash mismatch details */}
      {errorCode === 'HASH_MISMATCH' && details?.expectedHash && details?.actualHash && (
        <div className="text-xs font-mono bg-black/30 p-2 rounded border border-white/5 space-y-1">
          <p className="text-zinc-400">
            Expected: <span className="text-status-error">{details.expectedHash}</span>
          </p>
          <p className="text-zinc-400">
            Got: <span className="text-accent-cyan">{details.actualHash}</span>
          </p>
        </div>
      )}

      {/* File size details */}
      {errorCode === 'DOWNLOAD_FILE_TOO_SMALL' && details?.size && (
        <div className="text-xs text-zinc-400">
          Downloaded file size: {details.size} bytes
          {details.expected && <span> (expected: {details.expected}+ bytes)</span>}
        </div>
      )}

      {/* SourceForge mirrors attempted */}
      {errorCode === 'DOWNLOAD_SOURCEFORGE_FAILED' && details?.mirrorsAttempted && (
        <div className="text-xs text-zinc-400">
          Attempted mirrors: {details.mirrorsAttempted.join(', ')}
        </div>
      )}

      {/* Upload state details */}
      {(details?.uploadState || details?.commitState) && (
        <div className="text-xs text-zinc-400">
          State: {details.uploadState || details.commitState}
        </div>
      )}

      {/* Category-specific hint */}
      {hint && (
        <div className={cn(
          'text-sm p-3 rounded-lg border flex items-start gap-2',
          hint.showReVerify
            ? 'bg-status-warning/10 border-status-warning/20 text-status-warning'
            : 'bg-zinc-500/10 border-zinc-500/20 text-zinc-400'
        )}>
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div>
            <p>{hint.message}</p>
            {hint.showReVerify && (
              <Link
                href="/onboarding"
                className="inline-block mt-2 text-accent-cyan hover:underline"
              >
                Re-verify permissions
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
