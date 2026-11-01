/** Amounts are integer fen throughout the app. Never parse money with parseFloat. */
export function parseMoney(input: string, allowNegative = false): number {
  const value = input.trim();
  if (!(allowNegative ? /^-?\d+(?:\.\d{1,2})?$/ : /^\d+(?:\.\d{1,2})?$/).test(value)) {
    throw new Error('请输入有效金额，最多保留两位小数');
  }
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = value.replace(/^-/, '').split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) throw new Error('金额超出安全范围');
  return cents === 0 ? 0 : negative ? -cents : cents;
}

export function formatMoney(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new Error('金额必须为安全整数分');
  const absolute = Math.abs(cents);
  return `${cents < 0 ? '-' : ''}${Math.floor(absolute / 100).toLocaleString('en-US')}.${String(absolute % 100).padStart(2, '0')}`;
}

let sequence = 0;
/** UUID where available; the fallback only supplies local record identifiers, not secrets. */
export function makeId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  sequence = (sequence + 1) % 1_000_000;
  return `qz-${Date.now().toString(36)}-${sequence.toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function safeAdd(a: number, b: number): number {
  const result = a + b;
  if (!Number.isSafeInteger(result)) throw new Error('金额合计超出安全范围');
  return result;
}
