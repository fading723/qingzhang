import type { Period } from './types';

export const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const pad = (n: number) => String(n).padStart(2, '0');

export function daysInMonth(year: number, month: number): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month, 0);
  return date.getUTCDate();
}

function validParts(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): boolean {
  return (
    year >= 1 &&
    year <= 9999 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth(year, month) &&
    hour >= 0 &&
    hour <= 23 &&
    minute >= 0 &&
    minute <= 59 &&
    second >= 0 &&
    second <= 59
  );
}

export function isValidInstant(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  if (!match || !validParts(+match[1], +match[2], +match[3], +match[4], +match[5], +match[6]))
    return false;
  if (match[7] !== 'Z') {
    const [hour, minute] = match[7].slice(1).split(':').map(Number);
    if (hour > 23 || minute > 59) return false;
  }
  return Number.isFinite(Date.parse(value));
}

function instantDate(value: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(toInstant(`${value}T00:00`));
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return new Date(toInstant(value));
  if (!isValidInstant(value)) throw new Error('时间格式无效');
  return new Date(value);
}

/** Beijing wall clock, independent of the device time zone. */
export function localDateTime(iso = new Date().toISOString()): string {
  const local = new Date(instantDate(iso).getTime() + BEIJING_OFFSET_MS);
  return `${String(local.getUTCFullYear()).padStart(4, '0')}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
}

export function toInstant(local: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/.exec(local.trim());
  if (!match || !validParts(+match[1], +match[2], +match[3], +match[4], +match[5])) {
    throw new Error('请输入有效日期和时间，例如 2026-11-01 14:30');
  }
  const date = new Date(0);
  date.setUTCFullYear(+match[1], +match[2] - 1, +match[3]);
  date.setUTCHours(+match[4], +match[5], 0, 0);
  return new Date(date.getTime() - BEIJING_OFFSET_MS).toISOString();
}

export function monthKey(iso = new Date().toISOString()): string {
  return localDateTime(iso).slice(0, 7);
}

export function periodRange(
  period: Period,
  anchor: string,
): { start: string; end: string; label: string } {
  const date = new Date(instantDate(anchor).getTime() + BEIJING_OFFSET_MS);
  date.setUTCHours(0, 0, 0, 0);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  if (period === 'week') date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  if (period === 'month') date.setUTCDate(1);
  if (period === 'year') date.setUTCMonth(0, 1);
  const start = new Date(date.getTime() - BEIJING_OFFSET_MS).toISOString();
  const endDate = new Date(date);
  switch (period) {
    case 'day':
      endDate.setUTCDate(endDate.getUTCDate() + 1);
      break;
    case 'week':
      endDate.setUTCDate(endDate.getUTCDate() + 7);
      break;
    case 'month':
      endDate.setUTCMonth(endDate.getUTCMonth() + 1);
      break;
    case 'year':
      endDate.setUTCFullYear(endDate.getUTCFullYear() + 1);
      break;
    default:
      throw new Error('无效统计周期');
  }
  const end = new Date(endDate.getTime() - BEIJING_OFFSET_MS).toISOString();
  const startLocal = localDateTime(start).slice(0, 10);
  const lastLocal = localDateTime(new Date(Date.parse(end) - DAY_MS).toISOString()).slice(0, 10);
  const label =
    period === 'year'
      ? `${year}年`
      : period === 'month'
        ? `${year}年${month}月`
        : period === 'week'
          ? `${startLocal.replace(/-/g, '.')} — ${lastLocal.replace(/-/g, '.')}`
          : `${year}年${month}月${date.getUTCDate()}日`;
  return { start, end, label };
}

export function shiftPeriod(anchor: string, period: Period, delta: number): string {
  if (!Number.isInteger(delta)) throw new Error('周期偏移必须为整数');
  const date = new Date(instantDate(anchor).getTime() + BEIJING_OFFSET_MS);
  if (period === 'day' || period === 'week')
    date.setUTCDate(date.getUTCDate() + delta * (period === 'week' ? 7 : 1));
  else {
    const originalDay = date.getUTCDate();
    date.setUTCDate(1);
    if (period === 'month') date.setUTCMonth(date.getUTCMonth() + delta);
    else if (period === 'year') date.setUTCFullYear(date.getUTCFullYear() + delta);
    else throw new Error('无效统计周期');
    date.setUTCDate(
      Math.min(originalDay, daysInMonth(date.getUTCFullYear(), date.getUTCMonth() + 1)),
    );
  }
  return new Date(date.getTime() - BEIJING_OFFSET_MS).toISOString();
}
