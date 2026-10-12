import { describe, expect, it } from 'vitest';
import { shouldReactivateSupersededCandidate } from './candidate-reactivation';

describe('diagnostic candidates awaiting a separate grant', () => {
  it('does not reactivate an awaiting profile during ordinary enqueue', () => {
    expect(shouldReactivateSupersededCandidate('superseded', 'Awaiting diagnostic retest grant', true)).toBe(false);
  });

  it('still reactivates an ordinary superseded profile when its contract is valid', () => {
    expect(shouldReactivateSupersededCandidate('superseded', 'Obsolete profile', true)).toBe(true);
  });
});
