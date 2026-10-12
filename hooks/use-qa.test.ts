import { describe, expect, it } from 'vitest';
import { QaDetailsRequestError, shouldRetryQaDetails } from './use-qa';

describe('shouldRetryQaDetails', () => {
  it('retries a just-published exact result once', () => {
    const error = new QaDetailsRequestError('still publishing', 404, 2);
    expect(shouldRetryQaDetails(0, error)).toBe(true);
    expect(shouldRetryQaDetails(1, error)).toBe(false);
  });

  it('retries transient service errors without retrying rate limits', () => {
    expect(shouldRetryQaDetails(1, new QaDetailsRequestError('unavailable', 503, 2))).toBe(true);
    expect(shouldRetryQaDetails(2, new QaDetailsRequestError('unavailable', 503, 2))).toBe(false);
    expect(shouldRetryQaDetails(0, new QaDetailsRequestError('limited', 429, 30))).toBe(false);
  });
});
