/**
 * Logger utility for the packager service
 * Provides consistent logging with timestamps and levels
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

const LOG_LEVEL_NAMES: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: 'DEBUG',
  [LogLevel.INFO]: 'INFO',
  [LogLevel.WARN]: 'WARN',
  [LogLevel.ERROR]: 'ERROR',
};

let currentLogLevel = LogLevel.INFO;

export function setLogLevel(level: LogLevel): void {
  currentLogLevel = level;
}

export function getLogLevel(): LogLevel {
  return currentLogLevel;
}

function formatTimestamp(): string {
  return new Date().toISOString();
}

function formatMessage(level: LogLevel, context: string, message: string, data?: unknown): string {
  const timestamp = formatTimestamp();
  const levelName = LOG_LEVEL_NAMES[level];
  const dataStr = data !== undefined ? ` ${JSON.stringify(data)}` : '';
  return `[${timestamp}] [${levelName}] [${context}] ${message}${dataStr}`;
}

export function createLogger(context: string) {
  return {
    debug(message: string, data?: unknown): void {
      if (currentLogLevel <= LogLevel.DEBUG) {
        console.debug(formatMessage(LogLevel.DEBUG, context, message, data));
      }
    },

    info(message: string, data?: unknown): void {
      if (currentLogLevel <= LogLevel.INFO) {
        console.info(formatMessage(LogLevel.INFO, context, message, data));
      }
    },

    warn(message: string, data?: unknown): void {
      if (currentLogLevel <= LogLevel.WARN) {
        console.warn(formatMessage(LogLevel.WARN, context, message, data));
      }
    },

    error(message: string, data?: unknown): void {
      if (currentLogLevel <= LogLevel.ERROR) {
        console.error(formatMessage(LogLevel.ERROR, context, message, data));
      }
    },

    // Log progress for a job
    progress(jobId: string, percent: number, message: string): void {
      if (currentLogLevel <= LogLevel.INFO) {
        console.info(formatMessage(LogLevel.INFO, context, `[Job ${jobId}] ${percent}% - ${message}`));
      }
    },
  };
}

export type Logger = ReturnType<typeof createLogger>;
