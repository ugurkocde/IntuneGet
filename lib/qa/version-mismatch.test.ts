import { describe, expect, it } from 'vitest';
import { qaVersionMismatchKind, qaVersionMismatchMessage } from './version-mismatch';

describe('qaVersionMismatchMessage', () => {
  it('identifies a catalog version older than the tested version', () => {
    expect(qaVersionMismatchKind('2.4.0', '2.3.2')).toBe('catalog-older');
    expect(qaVersionMismatchMessage('2.4.0', '2.3.2')).toContain(
      'catalog still offers the older version 2.3.2'
    );
  });

  it('identifies a catalog version newer than the tested version', () => {
    expect(qaVersionMismatchKind('2.3.2', '2.4.0')).toBe('catalog-newer');
    expect(qaVersionMismatchMessage('2.3.2', '2.4.0')).toContain(
      'catalog now offers the newer version 2.4.0'
    );
  });

  it('does not invent a direction for equivalent but non-identical identifiers', () => {
    expect(qaVersionMismatchKind('1.2', '1.2.0')).toBe('equivalent-identifiers');
    expect(qaVersionMismatchMessage('1.2', '1.2.0')).toContain('identifiers differ');
  });
});
