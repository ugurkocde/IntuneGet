import { expect, it } from 'vitest';
import { qaSourceKey } from './source-backoff';

it('deduplicates sources across profiles but separates new versions, hashes, and URLs', () => {
  const source = { winget_id: 'Example.App', version: '1', architecture: 'x64', installer_url: 'https://example.com/app.msi', installer_sha256: 'A'.repeat(64) };
  expect(qaSourceKey(source)).toBe(qaSourceKey({ ...source, winget_id: 'example.app', installer_sha256: 'a'.repeat(64) }));
  for (const change of [{ version: '2' }, { installer_sha256: 'B'.repeat(64) }, { installer_url: 'https://example.com/new.msi' }]) {
    expect(qaSourceKey({ ...source, ...change })).not.toBe(qaSourceKey(source));
  }
});
