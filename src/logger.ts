import type { AppConfig } from './config.js';

type Level = AppConfig['logLevel'];
const priorities: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export class Logger {
  constructor(private readonly threshold: Level = 'info') {}

  debug(message: string, details?: unknown): void {
    this.write('debug', message, details);
  }

  info(message: string, details?: unknown): void {
    this.write('info', message, details);
  }

  warn(message: string, details?: unknown): void {
    this.write('warn', message, details);
  }

  error(message: string, details?: unknown): void {
    this.write('error', message, details);
  }

  private write(level: Level, message: string, details?: unknown): void {
    if (priorities[level] < priorities[this.threshold]) return;
    const suffix = details === undefined ? '' : ` ${safeStringify(details)}`;
    const line = `${new Date().toISOString()} ${level.toUpperCase()} ${message}${suffix}`;
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  }
}

function safeStringify(value: unknown): string {
  if (value instanceof Error) return JSON.stringify({ name: value.name, message: value.message });
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
