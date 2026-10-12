import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProgressStepper } from './ProgressStepper';

const PIPELINE_LABELS = ['Queued', 'Download', 'Package', 'Auth', 'Upload', 'Finalize'];

function labelClasses(html: string): Map<string, string> {
  const labels = new Map<string, string>();
  for (const match of html.matchAll(/<span class="([^"]*)">([^<]+)<\/span>/g)) {
    labels.set(match[2], match[1]);
  }
  return labels;
}

function render(props: Parameters<typeof ProgressStepper>[0]) {
  return labelClasses(renderToStaticMarkup(createElement(ProgressStepper, props)));
}

describe('ProgressStepper validation failures', () => {
  it.each([false, true])('fails at the installation check and leaves the pipeline pending (qaRequired %s)', (qaRequired) => {
    const labels = render({ progress: 0, status: 'failed', errorStage: 'validation', qaRequired });

    expect(labels.get('Installation check')).toContain('text-status-error');
    for (const label of PIPELINE_LABELS) {
      expect(labels.get(label)).toBeDefined();
      expect(labels.get(label)).not.toContain('text-status-success');
      expect(labels.get(label)).not.toContain('text-status-error');
    }
  });

  it('still marks the failing pipeline stage for a dispatch failure', () => {
    const labels = render({ progress: 0, status: 'failed', errorStage: 'authenticate' });

    expect(labels.has('Installation check')).toBe(false);
    expect(labels.get('Auth')).toContain('text-status-error');
    expect(labels.get('Package')).toContain('text-status-success');
    expect(labels.get('Upload')).not.toContain('text-status-success');
  });
});
