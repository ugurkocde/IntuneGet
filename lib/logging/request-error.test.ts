import { afterEach, expect, it, vi } from 'vitest';
import { onRequestError } from '../../instrumentation';
afterEach(() => vi.restoreAllMocks());
it('uses only framework route pattern, method and numeric digest', () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  onRequestError({ message: 'secret', stack: 'secret stack', digest: '123' }, { path: '/private?token=secret', method: 'GET', headers: { authorization: 'Bearer secret' } }, { routerKind: 'App Router', routePath: '/dashboard/[id]', routeType: 'render', revalidateReason: undefined });
  expect(log).toHaveBeenCalledWith('[request-error] type=render route=/dashboard/[id] method=GET digest=123');
});
it('does not let an unreadable digest break recovery', () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  expect(() => onRequestError({ get digest() { throw new Error('private'); } }, { path: '', method: 'GET', headers: {} }, { routerKind: 'App Router', routePath: '/', routeType: 'render', revalidateReason: undefined })).not.toThrow();
});
