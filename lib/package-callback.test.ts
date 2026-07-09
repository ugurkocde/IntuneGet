import { describe, expect, it } from 'vitest';
import {
  packageCallbackSchema,
  sanitizeErrorDetails,
  shouldApplyCallback,
} from './package-callback';

const jobId = '4a4f09e2-cc56-4ad2-a264-38b8f91e79c7';

describe('package callback contract', () => {
  it('accepts a versioned workflow callback', () => {
    const result = packageCallbackSchema.safeParse({
      schemaVersion: 2,
      eventId: 'c7b901b5-7d3a-42d8-b538-9ac38e4d36f9',
      attemptId: '123-1',
      sequence: 100,
      heartbeatAt: '2026-07-09T10:00:00.000Z',
      jobId,
      status: 'uploading',
      progress: 85,
    });

    expect(result.success).toBe(true);
  });

  it('rejects invalid progress and unknown statuses', () => {
    expect(packageCallbackSchema.safeParse({ jobId, status: 'uploading', progress: 101 }).success).toBe(false);
    expect(packageCallbackSchema.safeParse({ jobId, status: 'cancelled', progress: 0 }).success).toBe(false);
  });

  it('prevents regressions and terminal-state overwrites', () => {
    expect(shouldApplyCallback('uploading', 'packaging', '2026-07-09T10:00:00.000Z')).toBe(false);
    expect(shouldApplyCallback('cancelled', 'deployed', '2026-07-09T10:00:00.000Z')).toBe(false);
    expect(shouldApplyCallback('failed', 'uploading', '2026-07-09T10:00:00.000Z')).toBe(false);
  });

  it('rejects callbacks older than the saved job state', () => {
    expect(shouldApplyCallback(
      'packaging',
      'uploading',
      '2026-07-09T10:05:00.000Z',
      '2026-07-09T10:04:59.000Z',
    )).toBe(false);
  });

  it('removes signed URLs and secret-like fields from error details', () => {
    expect(sanitizeErrorDetails({
      statusCode: 403,
      url: 'https://storage.example/blob?sig=secret',
      encryptionKey: 'secret',
      operation: 'upload',
    })).toEqual({ statusCode: 403, operation: 'upload' });
  });
});
