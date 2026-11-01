import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { parseMoney, formatMoney, makeId } from '../src/domain/money';
import {
  localDateTime,
  toInstant,
  periodRange,
  shiftPeriod,
  monthKey,
  isValidInstant,
} from '../src/domain/time';
import { initialState } from '../src/domain/seed';
import {
  balances,
  budgetProgress,
  categoryTotals,
  deleteTransaction,
  filterTransactions,
  saveAccount,
  saveBudget,
  saveCategory,
  saveTransaction,
  summarize,
  validateState,
} from '../src/domain/ledger';
import {
  completeOccurrence,
  dueOccurrences,
  nextOccurrences,
  occurrenceAt,
  saveRule,
} from '../src/domain/recurring';
import type { LedgerState, RecurringRule, TransactionInput } from '../src/domain/types';

const at = (local: string) => toInstant(local);
function tx(patch: Partial<TransactionInput> = {}): TransactionInput {
  return {
    id: makeId(),
    kind: 'expense',
    amountCents: 100,
    accountId: 'account-cash',
    toAccountId: null,
    categoryId: 'cat-food',
    refundOfId: null,
    occurredAt: at('2024-01-01T12:00'),
    note: '',
    tags: [],
    recurringOccurrenceId: null,
    ...patch,
  };
}
function rule(patch: Partial<RecurringRule> = {}): RecurringRule {
  return {
    id: 'rent',
    name: '房租',
    kind: 'expense',
    amountCents: 200_000,
    accountId: 'account-cash',
    categoryId: 'cat-housing',
    note: '',
    tags: [],
    frequency: 'monthly',
    startAt: at('2024-01-31T09:30'),
    enabled: true,
    createdAt: at('2024-01-01T12:00'),
    ...patch,
  };
}
function extraAccount(
  state: LedgerState,
  id: string,
  openingBalanceCents = 0,
  type: 'bank' | 'credit' = 'bank',
): LedgerState {
  return saveAccount(state, {
    id,
    name: id,
    type,
    openingBalanceCents,
    archived: false,
    createdAt: at('2024-01-01T12:00'),
  });
}

test('money parsing is exact, bounded and rejects ambiguous values', () => {
  assert.equal(parseMoney('0.10') + parseMoney('0.20'), 30);
  assert.equal(parseMoney('00012.3'), 1230);
  assert.equal(parseMoney('-12.34', true), -1234);
  assert.equal(parseMoney('-0', true), 0);
  assert.equal(parseMoney('90071992547409.91'), Number.MAX_SAFE_INTEGER);
  for (const value of [
    '1.001',
    '1e2',
    '1,000',
    '.5',
    '12.',
    '-1',
    '',
    'Infinity',
    '90071992547409.92',
  ])
    assert.throws(() => parseMoney(value));
  assert.equal(formatMoney(-123456), '-1,234.56');
  assert.equal(formatMoney(0), '0.00');
});

test('Beijing timestamps are explicit and impossible calendar dates fail', () => {
  assert.equal(at('2024-02-29T00:00'), '2024-02-28T16:00:00.000Z');
  assert.equal(localDateTime('2024-02-28T16:00:00.000Z'), '2024-02-29T00:00');
  assert.equal(monthKey('2024-01-31T16:00:00.000Z'), '2024-02');
  for (const value of [
    '2023-02-29T12:00',
    '2024-04-31T12:00',
    '2024-02-29T24:00',
    '2024-2-29T12:00',
    '2024-01-01',
  ])
    assert.throws(() => at(value));
  assert.equal(isValidInstant('2024-02-30T00:00:00Z'), false);
  assert.equal(isValidInstant('2024-02-29T00:00:00+99:00'), false);
});

test('period boundaries use Monday weeks and half-open Beijing intervals', () => {
  const day = periodRange('day', at('2024-02-29T18:00'));
  assert.equal(day.start, at('2024-02-29T00:00'));
  assert.equal(day.end, at('2024-03-01T00:00'));
  const week = periodRange('week', at('2023-01-01T18:00'));
  assert.equal(week.start, at('2022-12-26T00:00'));
  assert.equal(week.end, at('2023-01-02T00:00'));
  assert.equal(periodRange('month', '2024-02-01').end, at('2024-03-01T00:00'));
  assert.equal(periodRange('year', '2024-06-01').end, at('2025-01-01T00:00'));
  assert.equal(shiftPeriod(at('2024-01-31T09:00'), 'month', 1), at('2024-02-29T09:00'));
  assert.equal(shiftPeriod(at('2024-02-29T09:00'), 'year', 1), at('2025-02-28T09:00'));
});

test('a new ledger has real empty state and valid classification', () => {
  const state = initialState();
  validateState(state);
  assert.equal(state.transactions.length, 0);
  assert.equal(state.accounts.length, 1);
  assert.equal(balances(state)['account-cash'], 0);
  assert.ok(state.categories.some((item) => item.kind === 'income'));
});

test('credit purchases, repayments and opening balances do not double-count spending', () => {
  let state = extraAccount(initialState(), 'bank', 100_000);
  state = extraAccount(state, 'credit', 0, 'credit');
  state = saveTransaction(state, tx({ id: 'purchase', accountId: 'credit', amountCents: 20_000 }));
  state = saveTransaction(
    state,
    tx({
      id: 'repay',
      kind: 'transfer',
      accountId: 'bank',
      toAccountId: 'credit',
      categoryId: null,
      amountCents: 20_000,
    }),
  );
  assert.deepEqual({ ...balances(state) }, { 'account-cash': 0, bank: 80_000, credit: 0 });
  assert.equal(summarize(state.transactions).expenseCents, 20_000);
  assert.equal(summarize(state.transactions).incomeCents, 0);
  assert.throws(() =>
    saveTransaction(state, tx({ kind: 'transfer', toAccountId: 'account-cash', categoryId: null })),
  );
});

test('editing and deleting transactions rederive both sides of balances atomically', () => {
  let state = extraAccount(initialState(), 'bank', 10_000);
  const transfer = tx({
    id: 'transfer',
    kind: 'transfer',
    categoryId: null,
    accountId: 'bank',
    toAccountId: 'account-cash',
    amountCents: 3_000,
  });
  state = saveTransaction(state, transfer);
  assert.deepEqual({ ...balances(state) }, { 'account-cash': 3_000, bank: 7_000 });
  state = saveTransaction(state, { ...transfer, amountCents: 2_000 });
  assert.equal(state.transactions.length, 1);
  assert.deepEqual({ ...balances(state) }, { 'account-cash': 2_000, bank: 8_000 });
  state = deleteTransaction(state, 'transfer');
  assert.deepEqual({ ...balances(state) }, { 'account-cash': 0, bank: 10_000 });
});

test('signed balance adjustments affect assets but never cash-flow reports', () => {
  let state = saveTransaction(
    initialState(),
    tx({ kind: 'adjustment', categoryId: null, amountCents: 50_000 }),
  );
  state = saveTransaction(
    state,
    tx({ kind: 'adjustment', categoryId: null, amountCents: -10_000 }),
  );
  assert.equal(balances(state)['account-cash'], 40_000);
  assert.equal(summarize(state.transactions).balanceCents, 0);
  assert.throws(() => saveTransaction(state, tx({ amountCents: 0 })));
  assert.throws(() => saveTransaction(state, tx({ amountCents: 0.5 })));
  assert.throws(() => saveTransaction(state, tx({ amountCents: -1 })));
});

test('partial multiple refunds belong to their own period and are capped by original spend', () => {
  let state = saveTransaction(
    initialState(),
    tx({ id: 'buy', amountCents: 10_000, occurredAt: at('2024-01-31T23:59') }),
  );
  state = saveTransaction(
    state,
    tx({
      id: 'r1',
      kind: 'refund',
      refundOfId: 'buy',
      amountCents: 3_000,
      categoryId: null,
      occurredAt: at('2024-02-01T00:00'),
    }),
  );
  state = saveTransaction(
    state,
    tx({
      id: 'r2',
      kind: 'refund',
      refundOfId: 'buy',
      amountCents: 7_000,
      occurredAt: at('2024-02-02T00:00'),
    }),
  );
  const january = summarize(filterTransactions(state, periodRange('month', '2024-01-01')));
  const february = summarize(filterTransactions(state, periodRange('month', '2024-02-01')));
  assert.equal(january.netExpenseCents, 10_000);
  assert.equal(february.netExpenseCents, -10_000);
  assert.equal(state.transactions.find((item) => item.id === 'r1')!.categoryId, 'cat-food');
  assert.equal(balances(state)['account-cash'], 0);
  assert.throws(
    () =>
      saveTransaction(
        state,
        tx({
          kind: 'refund',
          refundOfId: 'buy',
          amountCents: 1,
          occurredAt: at('2024-02-03T00:00'),
        }),
      ),
    /退款/,
  );
  assert.throws(
    () => saveTransaction(state, { ...state.transactions[0], amountCents: 9_999 }),
    /退款/,
  );
  assert.throws(() => deleteTransaction(state, 'buy'), /退款/);
  assert.throws(
    () =>
      saveTransaction(
        state,
        tx({ kind: 'refund', refundOfId: 'buy', occurredAt: at('2024-01-01T00:00') }),
      ),
    /退款/,
  );
});

test('recategorizing a refunded purchase updates its refund category consistently', () => {
  let state = saveTransaction(initialState(), tx({ id: 'buy', amountCents: 1_000 }));
  state = saveTransaction(
    state,
    tx({ id: 'refund', kind: 'refund', refundOfId: 'buy', amountCents: 500 }),
  );
  state = saveTransaction(state, { ...state.transactions[0], categoryId: 'cat-shopping' });
  assert.equal(state.transactions[1].categoryId, 'cat-shopping');
  state = deleteTransaction(state, 'refund');
  state = deleteTransaction(state, 'buy');
  assert.equal(state.transactions.length, 0);
});

test('moving occurrence time across midnight changes both day and month reports', () => {
  let state = saveTransaction(
    initialState(),
    tx({ id: 'late', occurredAt: at('2024-01-31T23:59') }),
  );
  assert.equal(filterTransactions(state, periodRange('month', '2024-01-01')).length, 1);
  state = saveTransaction(state, { ...state.transactions[0], occurredAt: at('2024-02-01T00:00') });
  assert.equal(filterTransactions(state, periodRange('month', '2024-01-01')).length, 0);
  assert.equal(filterTransactions(state, periodRange('day', '2024-02-01')).length, 1);
});

test('category trees are two levels, roll up in reports and preserve archived history', () => {
  let state = initialState();
  const parent = state.categories.find((item) => item.id === 'cat-food')!;
  state = saveCategory(state, { ...parent, id: 'coffee', parentId: parent.id, name: '咖啡' });
  state = saveTransaction(
    state,
    tx({ categoryId: 'coffee', amountCents: 2_500, note: '下午咖啡', tags: ['工作'] }),
  );
  assert.equal(
    filterTransactions(state, {
      categoryId: parent.id,
      query: '咖啡',
      tag: '工作',
      minCents: 2_000,
      maxCents: 3_000,
    }).length,
    1,
  );
  assert.equal(categoryTotals(state, state.transactions)[0].categoryId, parent.id);
  assert.throws(
    () => saveCategory(state, { ...parent, id: 'nested', parentId: 'coffee', name: '三级' }),
    /两级/,
  );
  assert.throws(() => saveCategory(state, { ...parent, parentId: parent.id }), /两级/);
  state = saveCategory(state, { ...parent, archived: true });
  assert.ok(state.categories.find((item) => item.id === 'coffee')!.archived);
  assert.equal(filterTransactions(state, { categoryId: parent.id }).length, 1);
  assert.throws(() => saveTransaction(state, tx({ categoryId: 'coffee' })), /可用分类/);
  state = saveTransaction(state, { ...state.transactions[0], amountCents: 3_000 });
  assert.equal(balances(state)['account-cash'], -3_000);
});

test('budgets use net spending and remain meaningful for refund-heavy months', () => {
  let state = saveTransaction(initialState(), tx({ id: 'buy', amountCents: 10_000 }));
  state = saveTransaction(
    state,
    tx({
      kind: 'refund',
      refundOfId: 'buy',
      amountCents: 3_000,
      occurredAt: at('2024-02-01T00:00'),
    }),
  );
  const january = { id: 'jan', month: '2024-01', categoryId: null, limitCents: 8_000 };
  const february = { id: 'feb', month: '2024-02', categoryId: 'cat-food', limitCents: 8_000 };
  state = saveBudget(saveBudget(state, january), february);
  assert.deepEqual(budgetProgress(state, january), {
    spentCents: 10_000,
    remainingCents: -2_000,
    ratio: 1.25,
  });
  assert.deepEqual(budgetProgress(state, february), {
    spentCents: -3_000,
    remainingCents: 11_000,
    ratio: 0,
  });
  assert.throws(() => saveBudget(state, { ...january, id: 'duplicate' }), /重复/);
});

test('monthly recurrence clamps to month end without drifting and yearly handles leap years', () => {
  const monthly = rule();
  assert.equal(occurrenceAt(monthly, 1), at('2024-02-29T09:30'));
  assert.equal(occurrenceAt(monthly, 2), at('2024-03-31T09:30'));
  const yearly = rule({ frequency: 'yearly', startAt: at('2024-02-29T09:30') });
  assert.equal(occurrenceAt(yearly, 1), at('2025-02-28T09:30'));
  assert.equal(occurrenceAt(yearly, 4), at('2028-02-29T09:30'));
});

test('confirm and skip are idempotent; deleting generated bill cannot regenerate it', () => {
  let state = saveRule(initialState(), rule());
  const pending = dueOccurrences(state, at('2024-02-29T09:30'));
  assert.equal(pending.length, 2);
  assert.equal(state.transactions.length, 0);
  state = completeOccurrence(state, pending[0], 'post');
  const again = completeOccurrence(state, pending[0], 'post');
  assert.equal(again, state);
  assert.equal(state.transactions.length, 1);
  assert.equal(state.transactions[0].occurredAt, pending[0].scheduledAt);
  state = completeOccurrence(state, pending[1], 'skip');
  assert.equal(dueOccurrences(state, at('2024-02-29T09:30')).length, 0);
  assert.throws(() => saveRule(state, { ...rule(), frequency: 'weekly' }), /已有处理记录/);
  state = deleteTransaction(state, state.transactions[0].id);
  assert.equal(state.occurrences[0].status, 'skipped');
  assert.equal(dueOccurrences(state, at('2024-02-29T09:30')).length, 0);
  assert.throws(() => completeOccurrence(state, { ...pending[0], id: 'fake' }, 'post'), /规则/);
});

test('notification planning uses future dates and archived dependencies stop rules', () => {
  let state = saveRule(initialState(), rule());
  const next = nextOccurrences(state, at('2024-02-01T00:00'), 2);
  assert.deepEqual(
    next.map((item) => item.scheduledAt),
    [at('2024-02-29T09:30'), at('2024-03-31T09:30')],
  );
  state = saveAccount(state, { ...state.accounts[0], archived: true });
  assert.equal(state.recurringRules[0].enabled, false);
  assert.equal(nextOccurrences(state).length, 0);
  assert.equal(dueOccurrences(state).length, 0);
});

test('backup validation rejects malformed shape, duplicate IDs and broken references', () => {
  const state = saveTransaction(initialState(), tx());
  const bad: unknown[] = [
    null,
    {},
    { ...state, version: 99 },
    { ...state, settings: {} },
    { ...state, transactions: [state.transactions[0], state.transactions[0]] },
    { ...state, transactions: [{ ...state.transactions[0], accountId: 'missing' }] },
    {
      ...state,
      transactions: [{ ...state.transactions[0], amountCents: Number.MAX_SAFE_INTEGER + 1 }],
    },
    {
      ...state,
      transactions: [{ ...state.transactions[0], occurredAt: '2024-02-30T00:00:00.000Z' }],
    },
    { ...state, transactions: [{ ...state.transactions[0], recurringOccurrenceId: 'missing' }] },
    { ...state, categories: [{ ...state.categories[0], parentId: 'missing' }] },
    { ...state, budgets: [{ id: 'bad', month: '2024-13', categoryId: null, limitCents: 100 }] },
  ];
  for (const candidate of bad) assert.throws(() => validateState(candidate));
  const restored: unknown = JSON.parse(JSON.stringify(state));
  validateState(restored);
  assert.deepEqual({ ...balances(restored) }, { ...balances(state) });
});

test('aggregate overflow is rejected before a state can be persisted', () => {
  const state = extraAccount(initialState(), 'big', Number.MAX_SAFE_INTEGER);
  assert.throws(
    () =>
      saveTransaction(
        state,
        tx({ kind: 'income', categoryId: 'cat-salary', accountId: 'big', amountCents: 1 }),
      ),
    /安全范围/,
  );
});

test('10,000 records can be validated, filtered and aggregated without losing precision', (t) => {
  const state = initialState();
  const base = Date.parse(at('2024-01-01T00:00'));
  state.transactions = Array.from({ length: 10_000 }, (_, index) => ({
    ...tx({
      id: `load-${index}`,
      amountCents: 101,
      occurredAt: new Date(base + index * 60_000).toISOString(),
      note: index % 2 ? '日常午餐' : '早餐',
      tags: index % 2 ? ['工作'] : [],
    }),
    createdAt: at('2024-02-01T00:00'),
    updatedAt: at('2024-02-01T00:00'),
  }));
  const start = performance.now();
  validateState(state);
  const selected = filterTransactions(state, {
    ...periodRange('month', '2024-01-01'),
    query: '午餐',
    minCents: 100,
    maxCents: 200,
  });
  assert.equal(selected.length, 5_000);
  assert.equal(summarize(selected).expenseCents, 505_000);
  assert.equal(categoryTotals(state, state.transactions)[0].amountCents, 1_010_000);
  assert.equal(balances(state)['account-cash'], -1_010_000);
  const elapsed = performance.now() - start;
  t.diagnostic(`10,000 records: validation + filter + aggregation ${elapsed.toFixed(1)} ms`);
  assert.ok(elapsed < 5_000, `Performance regression: ${elapsed.toFixed(0)} ms`);
});
