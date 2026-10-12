import { determineDeploymentMode } from '@/lib/config';
import { createFileSink } from './file-sink';
import { formatLogLine, levelAllows, LOG_LEVELS, parseLogLevel, type LogLevel } from './log-format';

const installed = Symbol.for('intuneget.consoleCapture');
export function installConsoleCapture(): void {
  if (process.env.NEXT_PHASE === 'phase-production-build' || determineDeploymentMode() === 'hosted') return;
  const state = globalThis as typeof globalThis & { [installed]?: boolean };
  if (state[installed]) return;
  state[installed] = true;
  const stderr = process.stderr.write.bind(process.stderr);
  const configured = process.env.INTUNEGET_LOG_LEVEL;
  const minimum = parseLogLevel(configured);
  if (configured && !LOG_LEVELS.includes(configured as LogLevel)) stderr('[intuneget-log] invalid level; using info\n');
  const sink = process.env.INTUNEGET_LOG_DIR?.trim()
    ? createFileSink({ dir: process.env.INTUNEGET_LOG_DIR.trim(), notice: stderr }) : undefined;
  let inside = false;
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    const original = console[method].bind(console);
    const level = method === 'log' ? 'info' : method;
    console[method] = (...args: unknown[]) => {
      if (inside) { original(...args); return; }
      if (!levelAllows(minimum, level)) return;
      inside = true;
      try { original(...args); sink?.write(formatLogLine(level, args)); }
      finally { inside = false; }
    };
  }
}
