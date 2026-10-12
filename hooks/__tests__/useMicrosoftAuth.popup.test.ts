import { describe, expect, it, vi } from 'vitest';
vi.mock('@azure/msal-react', () => ({ useMsal: () => ({}), useIsAuthenticated: () => false }));
import { isBlockedPopupError } from '../useMicrosoftAuth';

describe('blocked sign-in popup detection', () => {
  it('recognizes MSAL errors for a popup that could not open', () => {
    expect(isBlockedPopupError({ errorCode: 'popup_window_error' })).toBe(true);
    expect(isBlockedPopupError({ errorCode: 'empty_window_error' })).toBe(true);
  });
  it('does not redirect when the user cancelled or another error occurred', () => {
    for (const error of [{ errorCode: 'user_cancelled' }, { errorCode: 'interaction_in_progress' }, new Error('x'), null, undefined]) {
      expect(isBlockedPopupError(error)).toBe(false);
    }
  });
});
