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

  it('keeps non-QA installer validation separate from an installation test', () => {
    const html = renderToStaticMarkup(createElement(ErrorDisplay, {
      errorCode: 'HASH_MISMATCH', errorStage: 'validation', errorCategory: 'validation',
    }));
    expect(html).toContain('Failed at: Validation');
    expect(html).toContain('SHA256 hash mismatch');
    expect(html).not.toContain('Installation check');
  });
});

it.each(['VERSION_UNAVAILABLE','PACKAGE_UNAVAILABLE'])('shows availability without a failed QA claim: %s',errorCode=>{const html=renderToStaticMarkup(createElement(ErrorDisplay,{errorCode,errorCategory:'validation',errorMessage:'This app version is not available for automated deployment.'}));expect(html).toContain('Not available');expect(html).toContain('did not run an installation test');expect(html).not.toContain('did not pass');});

it('does not offer another version when the whole app is unavailable', () => {
 const html=renderToStaticMarkup(createElement(ErrorDisplay,{errorCode:'PACKAGE_UNAVAILABLE',errorCategory:'validation'}));
 expect(html).toContain('This app is not available for automated deployment. This request did not run an installation test.');
 expect(html).not.toContain('Select an available app version');
});

it('uses truthful pretest wording only for an annotated QA failure',()=>{
 const html=renderToStaticMarkup(createElement(ErrorDisplay,{errorCode:'QA_FAILED_EXECUTION_PROFILE',errorStage:'validation',errorMessage:'VirusTotal: awaiting engine coverage, rechecking daily',securityBlocked:true}));
 expect(html).toContain('Security check');expect(html).toContain('A security check stopped this deployment before the installation test ran.');expect(html).not.toContain('did not pass the installation check');expect(html).not.toContain('VirusTotal');
});
it('ignores the display flag for other error codes',()=>{
 const props={errorCode:'HASH_MISMATCH',errorStage:'validation',errorMessage:'SHA mismatch'};
 expect(renderToStaticMarkup(createElement(ErrorDisplay,{...props,securityBlocked:true}))).toBe(renderToStaticMarkup(createElement(ErrorDisplay,props)));
});

it.each(['VERSION_UNAVAILABLE','PACKAGE_UNAVAILABLE'])('keeps legacy installer category out of availability guidance %s',errorCode=>{
 const html=renderToStaticMarkup(createElement(ErrorDisplay,{errorCode,errorCategory:'installer',errorStage:'validation',errorMessage:'This app version is not available for automated deployment.'}));
 expect(html).toContain('Not available');expect(html).toContain('This request did not run an installation test.');expect(html).not.toContain('unsupported installer format');expect(html).not.toContain('did not pass the installation check');
});
