type Stage = 'resolveApp' | 'qa' | 'changelog' | 'installer' | 'related';
const stages: Stage[] = ['resolveApp', 'qa', 'changelog', 'installer', 'related'];

/** Observe foreground reads without changing, racing or cancelling their promises. */
export function createCatalogStageTrace() {
  const started = performance.now();
  const pending = new Set<Stage>();
  const settled: Partial<Record<Stage, { ms: number; outcome: 'fulfilled' | 'rejected' }>> = {};
  const elapsed = () => Math.round(performance.now() - started);
  const snapshot = () => ({
    route: 'appdetail', elapsedMs: elapsed(), settled: { ...settled },
    pending: stages.filter(stage => pending.has(stage)),
    notStarted: stages.filter(stage => !pending.has(stage) && !settled[stage]),
  });
  // The affected production requests expire after 15 seconds; log before that bound.
  const timer = setTimeout(() => console.warn('Catalog page stage pending', snapshot()), 10000);
  timer.unref?.();
  return {
    track<T>(stage: Stage, promise: Promise<T>): Promise<T> {
      const at = performance.now();
      pending.add(stage);
      const finish = (outcome: 'fulfilled' | 'rejected') => {
        pending.delete(stage);
        settled[stage] = { ms: Math.round(performance.now() - at), outcome };
      };
      void promise.then(() => finish('fulfilled'), () => finish('rejected'));
      return promise;
    },
    async run<T>(operation: () => Promise<T>): Promise<T> {
      try { return await operation(); }
      finally {
        clearTimeout(timer);
        if (elapsed() >= 5000) console.warn('Catalog page stage completed', snapshot());
      }
    },
  };
}
