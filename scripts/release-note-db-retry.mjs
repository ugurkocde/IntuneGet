/** Retry transient database responses using a fresh request on each attempt. */
export async function withDatabaseRetry(operation, {sleep = ms => new Promise(resolve => setTimeout(resolve, ms))} = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await operation();
    if (!result.error) return result;
    const transient = result.status === 0 || result.status === 408 || result.status === 429 || result.status >= 500 || result.error.code === '57014' || result.error.code === '40001' || result.error.code === '40P01';
    if (!transient || attempt === 2) throw new Error(`Release-note database request failed (${result.error.code || result.status || 'transport'})`);
    await sleep(1000 * 2 ** attempt);
  }
}
