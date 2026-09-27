import 'dotenv/config';
import { resolve } from 'node:path';

export interface AppConfig {
  larkCliBin: string;
  larkCliProfile?: string;
  pushIntervalMinutes: number;
  pendingReminderMinutes: number;
  timezone: string;
  allowedOpenIds: Set<string>;
  knownIntervalsDays: number[];
  unknownRetryMinutes: number;
  databasePath: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

function csv(value: string | undefined, fallback: string): string[] {
  return (value ?? fallback)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function positiveNumbers(value: string | undefined, fallback: string): number[] {
  const parsed = csv(value, fallback).map(Number);
  if (parsed.length === 0 || parsed.some((number) => !Number.isFinite(number) || number <= 0)) {
    throw new Error('KNOWN_INTERVALS_DAYS 必须是逗号分隔的正数');
  }
  return parsed;
}

function timezone(value: string | undefined): string {
  const candidate = value?.trim() || 'Asia/Shanghai';
  try {
    new Intl.DateTimeFormat('zh-CN', { timeZone: candidate }).format();
  } catch {
    throw new Error(`无效的 TIMEZONE: ${candidate}`);
  }
  return candidate;
}

export function loadConfig(): AppConfig {
  const pushIntervalMinutes = Number(process.env.PUSH_INTERVAL_MINUTES ?? '5');
  if (!Number.isInteger(pushIntervalMinutes) || pushIntervalMinutes <= 0) {
    throw new Error('PUSH_INTERVAL_MINUTES 必须是正整数');
  }

  const pendingReminderMinutes = Number(process.env.PENDING_REMINDER_MINUTES ?? '30');
  if (!Number.isInteger(pendingReminderMinutes) || pendingReminderMinutes <= 0) {
    throw new Error('PENDING_REMINDER_MINUTES 必须是正整数');
  }

  const unknownRetryMinutes = Number(process.env.UNKNOWN_RETRY_MINUTES ?? '20');
  if (!Number.isFinite(unknownRetryMinutes) || unknownRetryMinutes <= 0) {
    throw new Error('UNKNOWN_RETRY_MINUTES 必须是正数');
  }

  const rawLevel = process.env.LOG_LEVEL?.trim().toLowerCase() ?? 'info';
  if (!['debug', 'info', 'warn', 'error'].includes(rawLevel)) {
    throw new Error('LOG_LEVEL 只能是 debug、info、warn 或 error');
  }

  return {
    larkCliBin: process.env.LARK_CLI_BIN?.trim() || 'lark-cli',
    larkCliProfile: process.env.LARK_CLI_PROFILE?.trim() || undefined,
    pushIntervalMinutes,
    pendingReminderMinutes,
    timezone: timezone(process.env.TIMEZONE),
    allowedOpenIds: new Set(csv(process.env.ALLOWED_OPEN_IDS, '')),
    knownIntervalsDays: positiveNumbers(process.env.KNOWN_INTERVALS_DAYS, '1,3,7,14,30,60'),
    unknownRetryMinutes,
    databasePath: resolve(process.cwd(), process.env.DATABASE_PATH?.trim() || './data/pte-learning.db'),
    logLevel: rawLevel as AppConfig['logLevel'],
  };
}
