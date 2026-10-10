import { describe, expect, it } from 'vitest';
import { logValue } from '@/lib/server-log';

describe('logValue', () => {
  it('replaces line breaks so a value cannot forge another log line', () => {
    expect(logValue('Test.App\r\n[Package] Deployment job forged')).toBe(
      'Test.App [Package] Deployment job forged'
    );
  });

  it('redacts URLs and credential parameters', () => {
    expect(
      logValue('Download failed for https://example.blob.core.windows.net/a.exe?sv=1&sig=abc (token=xyz)')
    ).toBe('Download failed for [redacted URL] (token=[redacted])');
  });

  it('redacts quoted credentials and Bearer tokens', () => {
    expect(logValue('Request failed: token="abc123", Authorization: Bearer eyJ0.abc-def_1=')).toBe(
      'Request failed: token="[redacted]", Authorization: Bearer [redacted]'
    );
    expect(logValue("password: 'hunter2' secret=xyz")).toBe("password: '[redacted]' secret=[redacted]");
  });

  it('bounds the length', () => {
    expect(logValue('a'.repeat(20), 5)).toBe('aaaaa...');
  });

  it('handles missing values', () => {
    expect(logValue(undefined)).toBe('');
  });
});
