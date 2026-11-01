import type { DueOccurrence, LedgerState, RecurringRule, TransactionInput } from './types';
import { makeId } from './money';
import { isValidInstant, localDateTime, shiftPeriod } from './time';
import { saveTransaction, validateState } from './ledger';

const MAX_PENDING = 1_000;
const DAY_MS = 86_400_000;
const periodFor = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' } as const;

export function occurrenceAt(rule: RecurringRule, index: number): string {
  if (!Number.isSafeInteger(index) || index < 0) throw new Error('周期序号无效');
  return shiftPeriod(rule.startAt, periodFor[rule.frequency], index);
}

function nearIndex(rule: RecurringRule, now: string): number {
  const start = localDateTime(rule.startAt);
  const current = localDateTime(now);
  if (rule.frequency === 'daily' || rule.frequency === 'weekly')
    return Math.max(
      0,
      Math.floor(
        (Date.parse(now) - Date.parse(rule.startAt)) /
          (DAY_MS * (rule.frequency === 'weekly' ? 7 : 1)),
      ),
    );
  if (rule.frequency === 'monthly')
    return Math.max(
      0,
      (+current.slice(0, 4) - +start.slice(0, 4)) * 12 + +current.slice(5, 7) - +start.slice(5, 7),
    );
  return Math.max(0, +current.slice(0, 4) - +start.slice(0, 4));
}

function due(rule: RecurringRule, scheduledAt: string): DueOccurrence {
  return { id: `${rule.id}@${scheduledAt}`, ruleId: rule.id, scheduledAt, rule };
}

export function saveRule(state: LedgerState, rule: RecurringRule): LedgerState {
  const old = state.recurringRules.find((item) => item.id === rule.id);
  if (
    old &&
    state.occurrences.some((item) => item.ruleId === rule.id) &&
    (Date.parse(old.startAt) !== Date.parse(rule.startAt) || old.frequency !== rule.frequency)
  ) {
    throw new Error('已有处理记录的周期不能修改开始时间或频率，请停用后新建');
  }
  const normalized = {
    ...rule,
    name: rule.name.trim(),
    note: rule.note.trim(),
    tags: [...new Set(rule.tags.map((item) => item.trim()).filter(Boolean))],
    startAt: isValidInstant(rule.startAt) ? new Date(rule.startAt).toISOString() : rule.startAt,
    createdAt: old?.createdAt ?? rule.createdAt,
  };
  const next = {
    ...state,
    recurringRules: old
      ? state.recurringRules.map((item) => (item.id === rule.id ? normalized : item))
      : [...state.recurringRules, normalized],
  };
  validateState(next);
  return next;
}

/** Returns the oldest 1,000 outstanding items. More become visible after processing these. */
export function dueOccurrences(
  state: LedgerState,
  now = new Date().toISOString(),
): DueOccurrence[] {
  if (!isValidInstant(now)) throw new Error('当前时间无效');
  const completed = new Set(state.occurrences.map((item) => item.id));
  const items: DueOccurrence[] = [];
  for (const rule of state.recurringRules) {
    if (!rule.enabled || Date.parse(rule.startAt) > Date.parse(now)) continue;
    const finalIndex = nearIndex(rule, now);
    let pending = 0;
    for (let index = 0; index <= finalIndex && pending < MAX_PENDING; index++) {
      const scheduledAt = occurrenceAt(rule, index);
      if (Date.parse(scheduledAt) > Date.parse(now)) break;
      const item = due(rule, scheduledAt);
      if (!completed.has(item.id)) {
        items.push(item);
        pending++;
      }
    }
  }
  return items
    .sort(
      (a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt) || a.id.localeCompare(b.id),
    )
    .slice(0, MAX_PENDING);
}

/** Future items for local notifications, across all rules in chronological order. */
export function nextOccurrences(
  state: LedgerState,
  now = new Date().toISOString(),
  limit = 30,
): DueOccurrence[] {
  if (!isValidInstant(now) || !Number.isInteger(limit) || limit < 0 || limit > 1_000)
    throw new Error('提醒参数无效');
  if (!limit) return [];
  const completed = new Set(state.occurrences.map((item) => item.id));
  const items: DueOccurrence[] = [];
  for (const rule of state.recurringRules) {
    if (!rule.enabled) continue;
    let index = nearIndex(rule, now);
    let count = 0;
    // Completed future occurrences are unusual but must not make notification planning unbounded.
    const maxAttempts =
      limit + state.occurrences.filter((item) => item.ruleId === rule.id).length + 2;
    for (let attempts = 0; count < limit && attempts < maxAttempts; attempts++, index++) {
      const scheduledAt = occurrenceAt(rule, index);
      if (!isValidInstant(scheduledAt)) break;
      const item = due(rule, scheduledAt);
      if (Date.parse(scheduledAt) > Date.parse(now) && !completed.has(item.id)) {
        items.push(item);
        count++;
      }
    }
  }
  return items
    .sort(
      (a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt) || a.id.localeCompare(b.id),
    )
    .slice(0, limit);
}

export function completeOccurrence(
  state: LedgerState,
  requested: DueOccurrence,
  action: 'post' | 'skip',
): LedgerState {
  if (action !== 'post' && action !== 'skip') throw new Error('无效周期操作');
  if (state.occurrences.some((item) => item.id === requested.id)) return state;
  const rule = state.recurringRules.find((item) => item.id === requested.ruleId);
  if (!rule?.enabled) throw new Error('周期规则已停用或不存在');
  if (!isValidInstant(requested.scheduledAt)) throw new Error('计划时间无效');
  const scheduledAt = new Date(requested.scheduledAt).toISOString();
  const candidate = occurrenceAt(rule, nearIndex(rule, scheduledAt));
  const id = `${rule.id}@${scheduledAt}`;
  if (candidate !== scheduledAt || requested.id !== id) throw new Error('计划时间不符合周期规则');
  if (action === 'skip') {
    const next: LedgerState = {
      ...state,
      occurrences: [
        ...state.occurrences,
        { id, ruleId: rule.id, scheduledAt, status: 'skipped', transactionId: null },
      ],
    };
    validateState(next);
    return next;
  }
  const transactionId = makeId();
  const input: TransactionInput = {
    id: transactionId,
    kind: rule.kind,
    amountCents: rule.amountCents,
    accountId: rule.accountId,
    toAccountId: null,
    categoryId: rule.categoryId,
    refundOfId: null,
    occurredAt: scheduledAt,
    note: rule.note || rule.name,
    tags: [...rule.tags],
    recurringOccurrenceId: id,
  };
  const pending: LedgerState = {
    ...state,
    occurrences: [
      ...state.occurrences,
      { id, ruleId: rule.id, scheduledAt, status: 'posted', transactionId },
    ],
  };
  return saveTransaction(pending, input);
}
