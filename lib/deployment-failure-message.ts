interface CartAppLabel {
  wingetId: string;
  displayName: string;
}

const SAFE_REASONS = new Set([
  'Packaging pipeline not configured',
  'GitHub Actions packaging service not configured',
  'Failed to create job record',
]);
const MAX_LINES = 5;

/** Format application API failures without displaying raw upstream diagnostics. */
export function describeDeploymentFailure(data: unknown, items: readonly CartAppLabel[]): string {
  const result = data && typeof data === 'object'
    ? data as { errors?: unknown; message?: unknown }
    : {};
  if (!Array.isArray(result.errors) || result.errors.length === 0) {
    // The route's fixed count summary is safe; arbitrary upstream text is not.
    return typeof result.message === 'string' && result.message.length <= 80
      && /^\d+ job\(s\) processed, \d+ failed$/.test(result.message)
      ? result.message : 'No jobs were created';
  }

  const lines = result.errors.slice(0, MAX_LINES).map((value: unknown) => {
    const entry = value && typeof value === 'object'
      ? value as { wingetId?: unknown; error?: unknown } : {};
    const item = typeof entry.wingetId === 'string' && entry.wingetId.length > 0
      ? items.find(app => app.wingetId === entry.wingetId) : undefined;
    // Only associate an error with an app that was actually in this request.
    const name = item
      ? (item.displayName || item.wingetId).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 120)
      : 'Selected app';
    const reason = item && typeof entry.error === 'string' && SAFE_REASONS.has(entry.error)
      ? entry.error : 'Could not be started';
    return `${name || 'Selected app'}: ${reason}`;
  });
  if (result.errors.length > MAX_LINES) lines.push(`And ${result.errors.length - MAX_LINES} more`);
  return lines.join('\n');
}
