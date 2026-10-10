import { describe, expect, it } from 'vitest';
import { logValue } from '@/lib/server-log';

describe('logValue', () => {
  it('replaces line breaks so a value cannot forge another log line', () => {
    expect(logValue('Test.App\r\n[Package] Deployment job forged')).toBe(
      'Test.App [Package] Deployment job forged'
    );
  });

  it('replaces C1 controls, Unicode line separators and bidirectional formatting', () => {
    expect(logValue('a\u0085b\u2028c\u2029d\u202ee\u2066f\u009fg')).toBe('a b c d e f g');
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

  it('bounds the length', () => {
    expect(logValue('a'.repeat(20), 5)).toBe('aaaaa...');
  });

  it('handles missing values', () => {
    expect(logValue(undefined)).toBe('');
  });
});
