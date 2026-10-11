import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ErrorDisplay } from '../ErrorDisplay';
import { isIntuneApprovalFailure } from '@/lib/intune-approval';

describe('approval failure guidance', () => {
  it('explains the retained upload instead of suggesting approval automatically enables retry', () => {
    const html = renderToStaticMarkup(createElement(ErrorDisplay, { errorCategory: 'approval', errorCode: 'INTUNE_APPROVAL_REQUIRED' }));
    expect(html).toContain('approving the request alone does not resume this upload');
    expect(html).not.toContain('then retry the upload');
  });
  it('recognizes approval failures by category or callback code for Retry safely visibility', () => {
    expect(isIntuneApprovalFailure({ error_category: 'approval' })).toBe(true);
    expect(isIntuneApprovalFailure({ error_code: 'INTUNE_APPROVAL_REQUIRED', error_category: 'system' })).toBe(true);
    expect(isIntuneApprovalFailure({ error_category: 'network' })).toBe(false);
  });
});
