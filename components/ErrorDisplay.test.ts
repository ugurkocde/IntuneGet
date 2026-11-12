import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorDisplay } from './ErrorDisplay';

const translation = vi.hoisted(() => ({ messages: [] as string[], localized: false }));
vi.mock('gt-next', () => ({
  T: ({ children }: { children: ReactNode }) => {
    if (typeof children !== 'string') return children;
    translation.messages.push(children);
    return translation.localized ? `translated: ${children}` : children;
  },
}));
beforeEach(() => { translation.messages = []; translation.localized = false; });

describe('ErrorDisplay QA failure stage', () => {
  it.each(['MANIFEST_UNAVAILABLE', 'INSTALLER_TYPE_UNAVAILABLE', 'INSTALL_SCOPE_UNAVAILABLE', 'SILENT_INSTALL_UNAVAILABLE'])('explains a terminal manifest validation failure without claiming a downloaded file failed: %s', errorCode => {
    const html = renderToStaticMarkup(createElement(ErrorDisplay, {
      errorCode, errorStage: 'validation', errorCategory: 'validation',
      errorMessage: 'The selected package could not be validated. Review your selection before trying again.',
    }));
    expect(html).toContain('The selected package or installation settings could not be validated.');
    expect(html).toContain('Refresh the app catalog and review your selection before trying again.');
    expect(html).not.toContain('downloaded file');
    expect(html).not.toContain('unsupported installer format');
  });

  it('names an unsupported dependency without QA or installer failure guidance', () => {
    const html = renderToStaticMarkup(createElement(ErrorDisplay, {
      errorCode: 'DEPENDENCY_NOT_SUPPORTED', errorStage: 'validation', errorCategory: 'validation',
      errorMessage: 'This app requires Microsoft.WindowsAppRuntime.2, which is not supported yet. Automated deployment is blocked.',
    }));
    expect(html).toContain('Not supported yet');
    expect(html).toContain('Microsoft.WindowsAppRuntime.2');
    expect(html).not.toContain('did not pass');
    expect(html).not.toContain('unsupported installer format');
    expect(html).not.toContain('downloaded file');
  });
  it('preserves the manifest rejection and avoids packaging guidance for a legacy QA failure', () => {
    const html = renderToStaticMarkup(createElement(ErrorDisplay, {
      errorCode: 'QA_FAILED_EXECUTION_PROFILE',
      errorStage: 'validation',
      errorCategory: 'installer',
      errorMessage: 'Installer source quarantined before QA: MANIFEST_CHANGED. The selected installer is stale.',
    }));
    expect(html).toContain('Deployment validation');
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
    expect(html).toContain('Deployment validation');
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

describe('ErrorDisplay validation stops without lifecycle evidence', () => {
  it('translates the fixed stage and hint while retaining the original failure detail', () => {
    translation.localized = true;
    const html = renderToStaticMarkup(createElement(ErrorDisplay, {
      errorCode: 'QA_FAILED_EXECUTION_PROFILE', errorStage: 'validation',
      errorMessage: 'Original failure detail.',
    }));
    expect(html).toContain('Failed at: translated: Deployment validation');
    expect(html).toContain('translated: Deployment stopped during validation. Review the details above before trying again.');
    expect(html).toContain('Original failure detail.');
    expect(translation.messages).toEqual([
      'Deployment validation',
      'Deployment stopped during validation. Review the details above before trying again.',
    ]);
  });

  it.each([
    'Security checks stopped this request before installation testing.',
    'The requested app version is unavailable.',
    'Detection after installation did not pass.',
    null,
  ])('does not infer an installation test outcome from the QA code: %s', errorMessage => {
    const props = {
      errorCode: 'QA_FAILED_EXECUTION_PROFILE',
      errorStage: 'validation',
      errorCategory: 'installer',
      errorMessage,
    };
    const stored = { ...props };
    const html = renderToStaticMarkup(createElement(ErrorDisplay, props));
    expect(html).toContain('Failed at: Deployment validation');
    expect(html).toContain('Deployment stopped during validation. Review the details above before trying again.');
    expect(html).not.toContain('Installation check');
    expect(html).not.toContain('did not pass the installation check');
    expect(html).not.toContain('unsupported installer format');
    if (errorMessage) expect(html).toContain(errorMessage);
    expect(props).toEqual(stored);
  });
});

it.each(['VERSION_UNAVAILABLE','PACKAGE_UNAVAILABLE'])('shows availability without a failed QA claim: %s',errorCode=>{const html=renderToStaticMarkup(createElement(ErrorDisplay,{errorCode,errorCategory:'validation',errorMessage:'This app version is not available for automated deployment.'}));expect(html).toContain('Not available');expect(html).toContain('did not run an installation test');expect(html).not.toContain('did not pass');});

it('explains architecture availability without suggesting a different version or a failed test', () => {
 const html=renderToStaticMarkup(createElement(ErrorDisplay,{errorCode:'ARCHITECTURE_UNAVAILABLE',errorCategory:'validation',errorMessage:'Automated deployment is not available for this app architecture.'}));
 expect(html).toContain('Architecture not available');expect(html).toContain('This request did not run an installation test.');
 expect(html).not.toContain('Select an available app version');expect(html).not.toContain('did not pass');
});

it('translates architecture guidance while preserving the supplied detail', () => {
 translation.localized=true;
 const detail='Automated deployment is not available for this app architecture.';
 const html=renderToStaticMarkup(createElement(ErrorDisplay,{errorCode:'ARCHITECTURE_UNAVAILABLE',errorCategory:'validation',errorMessage:detail}));
 expect(html).toContain('translated: Architecture not available');
 expect(translation.messages).toContain('Automated deployment is not available for this architecture. This request did not run an installation test.');
 expect(html).toContain(detail);expect(html).not.toContain('translated: '+detail);
});

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
