import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ErrorDisplay } from './ErrorDisplay';

describe('ErrorDisplay QA failure stage', () => {
  it('preserves the manifest rejection and avoids packaging guidance for a legacy QA failure', () => {
    const html = renderToStaticMarkup(createElement(ErrorDisplay, {
      errorCode: 'QA_FAILED_EXECUTION_PROFILE',
      errorStage: 'validation',
      errorCategory: 'installer',
      errorMessage: 'Installer source quarantined before QA: MANIFEST_CHANGED. The selected installer is stale.',
    }));
    expect(html).toContain('Installation check');
    expect(html).toContain('MANIFEST_CHANGED');
    expect(html).toContain('Refresh the app catalog and select the current version');
    expect(html).not.toContain('There was an issue creating');
    expect(html).not.toContain('unsupported installer format');
  });

  it('keeps actual lifecycle failure details without suggesting a manifest change', () => {
    const html = renderToStaticMarkup(createElement(ErrorDisplay, {
      errorCode: 'QA_FAILED_EXECUTION_PROFILE', errorCategory: 'installer',
      errorMessage: 'Detection after installation did not pass.',
    }));
    expect(html).toContain('Detection after installation did not pass.');
    expect(html).toContain('Installation check');
    expect(html).not.toContain('trusted manifest');
    expect(html).not.toContain('unsupported installer format');
  });

  it('retains packaging guidance for a real package creation failure', () => {
    const html = renderToStaticMarkup(createElement(ErrorDisplay, {
      errorCode: 'PACKAGE_CREATION_FAILED', errorStage: 'package', errorCategory: 'installer',
    }));
    expect(html).toContain('Packaging');
    expect(html).toContain('Failed to create the .intunewin package');
    expect(html).toContain('unsupported installer format');
    expect(html).not.toContain('Installation check');
  });
});
