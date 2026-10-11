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
    const serialized = args.slice(0, 20).map(arg => typeof arg === 'string' ? arg : inspect(arg, {
      customInspect: false, getters: false, showProxy: false, depth: 3,
      maxArrayLength: 20, maxStringLength: 2000, breakLength: Infinity,
    })).join(' ');
    text = logValue(serialized
      .replace(/\S+/g, token => token.includes('@') ? '[redacted email]' : token)
      .replace(/\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/gi, '[redacted id]'), 8192)
      .replace(/[\r\n\u2028\u2029]/g, ' ');
  } catch { text = '[unformattable log arguments]'; }
  return now.toISOString() + ' ' + level.toUpperCase() + ' ' + text + '\n';
}
