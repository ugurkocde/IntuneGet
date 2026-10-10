import { describe, expect, it } from 'vitest';
import { logValue } from '@/lib/server-log';

describe('logValue', () => {
  it('replaces line breaks so a value cannot forge another log line', () => {
    expect(logValue('Test.App\r\n[Package] Deployment job forged')).toBe(
      'Test.App [Package] Deployment job forged'
    );
  });

  it('replaces C1 controls and Unicode line separators', () => {
    expect(logValue('a\u0085b\u2028c\u2029d\u009fe')).toBe('a b c d e');
  });

  it('removes bidirectional and zero width formatting so it cannot hide or split a secret', () => {
    expect(logValue('a\u202eb\u2066c\u2069d')).toBe('abcd');
    expect(logValue('pass\u200bword=S3cr3t sig=\u202eS3cr3t')).toBe('password=[redacted] sig=[redacted]');
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

  it('redacts bare JWTs', () => {
    expect(logValue('Graph rejected eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl-_x here')).toBe(
      'Graph rejected [redacted JWT] here'
    );
  });

  it('redacts classic GitHub tokens', () => {
    expect(logValue(`dispatch with ghs_${'A1b2'.repeat(9)} failed`)).toBe(
      'dispatch with [redacted GitHub token] failed'
    );
  });

  it('redacts fine grained GitHub tokens', () => {
    expect(logValue('token github_pat_11ABCDEFG0_abcdefXYZ123 rejected')).toBe(
      'token [redacted GitHub token] rejected'
    );
  });

  it('redacts Basic authorization', () => {
    expect(logValue('Authorization: Basic dXNlcjpwYXNzd29yZA== was refused')).toBe(
      'Authorization: Basic [redacted] was refused'
    );
  });

  it('keeps prose that mentions Basic authentication readable', () => {
    expect(logValue('Basic authentication is not supported')).toBe('Basic authentication is not supported');
  });

  it('redacts spaced key value credentials', () => {
    expect(logValue('password = S3cr3t; user=a')).toBe('password=[redacted]; user=a');
  });

  it('redacts JSON shaped client secrets', () => {
    expect(logValue('{"client_secret": "s3cr et", "name": "app"}')).toBe(
      '{"client_secret": "[redacted]", "name": "app"}'
    );
  });

  it('redacts other JSON shaped credential keys', () => {
    expect(logValue('{"access_token":"abc","refresh_token":"d e f","password":"x"}')).toBe(
      '{"access_token":"[redacted]","refresh_token":"[redacted]","password":"[redacted]"}'
    );
  });

  it('redacts quoted values that contain spaces', () => {
    expect(logValue("password='p a s s' next")).toBe("password='[redacted]' next");
  });

  it('redacts x-api-key headers', () => {
    expect(logValue('x-api-key: abc123, retry later')).toBe('x-api-key: [redacted], retry later');
  });

  it('redacts connection string passwords', () => {
    expect(logValue('Server=db;User Id=sa;Pwd=hunter2;')).toBe('Server=db;User Id=sa;Pwd=[redacted];');
  });

  it('redacts URL encoded signatures', () => {
    expect(logValue('redirect=blob%3Fsv%3D1%26sig%3Dabc123%26se%3D2')).toBe(
      'redirect=blob%3Fsv%3D1%26sig%3D[redacted]%26se%3D2'
    );
  });

  it('redacts a signed URL credential split by a line break', () => {
    const value = logValue('Download failed: https://host/file?sig=\nsecret-value end');
    expect(value).toBe('Download failed: [redacted URL] end');
    expect(value).not.toContain('secret-value');
  });

  it('stays linear on long adversarial input', () => {
    const inputs = [
      'a-'.repeat(50_000),
      '"' + 'a-'.repeat(50_000),
      'key-'.repeat(25_000),
      'eyJa-'.repeat(20_000),
      '3f2b1c9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f'.repeat(2_800),
    ];
    for (const input of inputs) {
      const started = performance.now();
      logValue(input);
      expect(performance.now() - started).toBeLessThan(200);
    }
  });

  it('bounds the length', () => {
    expect(logValue('a'.repeat(20), 5)).toBe('aaaaa...');
  });

  it('handles missing values', () => {
    expect(logValue(undefined)).toBe('');
  });
});
