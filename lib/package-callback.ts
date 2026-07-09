import { z } from 'zod';

export const packageJobStatuses = [
  'queued',
  'packaging',
  'uploading',
  'completed',
  'deployed',
  'failed',
  'cancelled',
  'duplicate_skipped',
] as const;

export type PackageJobStatus = (typeof packageJobStatuses)[number];

const callbackStatuses = [
  'packaging',
  'uploading',
  'deployed',
  'failed',
  'duplicate_skipped',
] as const;

export const packageCallbackSchema = z.object({
  schemaVersion: z.number().int().min(1).max(2).optional(),
  eventId: z.string().uuid().optional(),
  attemptId: z.string().trim().min(1).max(128).optional(),
  sequence: z.number().int().nonnegative().optional(),
  heartbeatAt: z.string().datetime({ offset: true }).optional(),
  jobId: z.string().uuid(),
  status: z.enum(callbackStatuses),
  phase: z.string().trim().min(1).max(64).optional(),
  message: z.string().max(2_000).optional(),
  progress: z.number().min(0).max(100).optional(),
  intuneAppId: z.string().trim().min(1).max(128).optional(),
  intuneAppUrl: z.string().url().max(2_048).optional(),
  duplicateInfo: z.object({
    matchType: z.enum(['exact', 'partial']),
    existingAppId: z.string().trim().min(1).max(128),
    existingVersion: z.string().max(128).optional(),
    createdAt: z.string().datetime({ offset: true }).optional(),
  }).optional(),
  warnings: z.array(z.string().max(1_000)).max(20).optional(),
  runId: z.union([z.string(), z.number().int().nonnegative()]).optional(),
  runUrl: z.string().url().max(2_048).optional(),
  errorStage: z.enum(['download', 'package', 'upload', 'authenticate', 'finalize', 'unknown']).optional(),
  errorCategory: z.enum(['network', 'validation', 'permission', 'installer', 'intune_api', 'system']).optional(),
  errorCode: z.string().regex(/^[A-Z0-9_]{1,80}$/).optional(),
  errorDetails: z.record(z.string(), z.unknown()).optional(),
  retryable: z.boolean().optional(),
  retryAfterSeconds: z.number().int().min(0).max(86_400).optional(),
});

export type PackageCallback = z.infer<typeof packageCallbackSchema>;

export const terminalPackageStatuses = new Set<PackageJobStatus>([
  'completed',
  'deployed',
  'failed',
  'cancelled',
  'duplicate_skipped',
]);

const statusRank: Record<PackageJobStatus, number> = {
  queued: 0,
  packaging: 1,
  uploading: 2,
  completed: 3,
  deployed: 3,
  failed: 3,
  cancelled: 3,
  duplicate_skipped: 3,
};

export function shouldApplyCallback(
  currentStatus: string,
  incomingStatus: PackageCallback['status'],
  currentUpdatedAt: string,
  heartbeatAt?: string,
): boolean {
  const normalizedCurrent = packageJobStatuses.includes(currentStatus as PackageJobStatus)
    ? currentStatus as PackageJobStatus
    : 'queued';

  if (terminalPackageStatuses.has(normalizedCurrent)) return false;
  if (statusRank[incomingStatus] < statusRank[normalizedCurrent]) return false;

  if (heartbeatAt) {
    const incomingTime = Date.parse(heartbeatAt);
    const savedTime = Date.parse(currentUpdatedAt);
    if (Number.isFinite(incomingTime) && Number.isFinite(savedTime) && incomingTime < savedTime) {
      return false;
    }
  }

  return true;
}

const sensitiveDetailKey = /(url|uri|token|secret|key|signature|authorization|password)/i;

export function sanitizeErrorDetails(
  details: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!details) return undefined;

  return Object.fromEntries(
    Object.entries(details)
      .filter(([key]) => !sensitiveDetailKey.test(key))
      .slice(0, 30)
      .map(([key, value]) => {
        if (typeof value === 'string') {
          const sanitized = value
            .replace(/https?:\/\/\S+/gi, '[redacted URL]')
            .replace(/(sig|token|secret|key)=[^\s&]+/gi, '$1=[redacted]');
          return [key, sanitized.slice(0, 2_000)];
        }
        if (typeof value === 'number' || typeof value === 'boolean' || value === null) return [key, value];
        if (Array.isArray(value)) return [key, value.slice(0, 20).map((item) => String(item).slice(0, 500))];
        return [key, '[redacted complex value]'];
      }),
  );
}
