import { inspect } from 'node:util';
import { logValue } from '@/lib/server-log';

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = typeof LOG_LEVELS[number];
export function parseLogLevel(value?: string): LogLevel {
  return LOG_LEVELS.includes(value as LogLevel) ? value as LogLevel : 'info';
}
export function levelAllows(minimum: LogLevel, level: LogLevel): boolean {
  return LOG_LEVELS.indexOf(level) >= LOG_LEVELS.indexOf(minimum);
}
export function formatLogLine(level: LogLevel, args: unknown[], now = new Date()): string {
  let text: string;
  try {
    text = logValue(args.slice(0, 20).map(arg => typeof arg === 'string' ? arg : inspect(arg, {
      customInspect: false, getters: false, showProxy: false, depth: 3,
      maxArrayLength: 20, maxStringLength: 2000, breakLength: Infinity,
    })).join(' '), 8192)
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted email]')
      .replace(/\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/gi, '[redacted id]')
      .replace(/[\r\n\u2028\u2029]/g, ' ');
  } catch { text = '[unformattable log arguments]'; }
  return now.toISOString() + ' ' + level.toUpperCase() + ' ' + text + '\n';
}
