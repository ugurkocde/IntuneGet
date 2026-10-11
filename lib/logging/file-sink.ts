import { mkdir, open, rename, rm } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';

export function createFileSink(options: {
  dir: string; maxBytes?: number; backups?: number; maxLines?: number;
  maxQueueBytes?: number; notice?: (text: string) => void;
}) {
  const maxBytes = options.maxBytes ?? 5 * 1024 * 1024;
  const backups = options.backups ?? 3;
  const maxLines = options.maxLines ?? 1000;
  const maxQueueBytes = options.maxQueueBytes ?? 1024 * 1024;
  const filename = path.join(options.dir, 'intuneget.log');
  let handle: FileHandle | undefined, size = 0, disabled = false, queued = 0, queuedBytes = 0, dropped = 0;
  let chain = Promise.resolve();
  const notice = options.notice ?? process.stderr.write.bind(process.stderr);
  async function append(line: string) {
    if (!handle) {
      await mkdir(options.dir, { recursive: true, mode: 0o750 });
      handle = await open(filename, 'a', 0o640);
      size = (await handle.stat()).size;
    }
    const bytes = Buffer.byteLength(line);
    if (size + bytes > maxBytes) {
      await handle.close(); handle = undefined;
      await rm(filename + '.' + backups, { force: true });
      for (let i = backups - 1; i >= 1; i--) {
        try { await rename(filename + '.' + i, filename + '.' + (i + 1)); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      }
      await rename(filename, filename + '.1');
      handle = await open(filename, 'a', 0o640); size = 0;
    }
    await handle.writeFile(line); size += bytes;
  }
  async function fail(error: unknown) {
    disabled = true;
    try { await handle?.close(); } catch { /* logging must not affect requests */ }
    handle = undefined;
    const code = (error as NodeJS.ErrnoException)?.code;
    try { notice('[intuneget-log] file logging disabled (' + (/^[A-Z0-9_]{1,24}$/.test(code ?? '') ? code : 'IO_ERROR') + ')\n'); } catch { /* fail open even if stderr is unavailable */ }
  }
  async function reportDropped() {
    if (!dropped || disabled) return;
    const count = dropped; dropped = 0;
    try { await append('[intuneget-log] dropped ' + count + ' lines\n'); }
    catch (error) { await fail(error); }
  }
  return {
    write(line: string) {
      if (disabled) return;
      const bytes = Buffer.byteLength(line);
      if (bytes > maxBytes || queued >= maxLines || queuedBytes + bytes > maxQueueBytes) { dropped++; return; }
      queued++; queuedBytes += bytes;
      chain = chain.then(async () => {
        try {
          if (disabled) return;
          await append(line);
          await reportDropped();
        } catch (error) { await fail(error); }
        finally { queued--; queuedBytes -= bytes; }
      });
    },
    async flush() { chain = chain.then(reportDropped); await chain; },
    async close() { chain = chain.then(async () => { await reportDropped(); await handle?.close(); handle = undefined; }); await chain; },
    get disabled() { return disabled; },
  };
}
