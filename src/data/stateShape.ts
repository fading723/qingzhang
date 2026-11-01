import { validateState } from '../domain/ledger';
import type { LedgerState } from '../domain/types';

/** Version 1 is a closed portable schema. Unknown trees must never enter persistence through a backup. */
export function assertKnownKeys(value: object, allowed: readonly string[], label: string): void {
  const keys = new Set(allowed);
  if (Object.keys(value).some((key) => !keys.has(key)))
    throw new Error(`${label}包含不支持的字段，请检查备份版本。`);
}

export function validateStoredState(value: unknown): asserts value is LedgerState {
  validateState(value);
  assertKnownKeys(
    value,
    [
      'version',
      'accounts',
      'categories',
      'transactions',
      'budgets',
      'recurringRules',
      'occurrences',
      'settings',
    ],
    '账本',
  );
  assertKnownKeys(value.settings, ['theme', 'currency', 'timeZone', 'lastBackupAt'], '设置');
  for (const item of value.accounts)
    assertKnownKeys(
      item,
      ['id', 'name', 'type', 'openingBalanceCents', 'archived', 'createdAt'],
      '账户',
    );
  for (const item of value.categories)
    assertKnownKeys(
      item,
      ['id', 'name', 'kind', 'parentId', 'icon', 'color', 'sortOrder', 'archived'],
      '分类',
    );
  for (const item of value.transactions)
    assertKnownKeys(
      item,
      [
        'id',
        'kind',
        'amountCents',
        'accountId',
        'toAccountId',
        'categoryId',
        'refundOfId',
        'occurredAt',
        'createdAt',
        'updatedAt',
        'note',
        'tags',
        'recurringOccurrenceId',
      ],
      '流水',
    );
  for (const item of value.budgets)
    assertKnownKeys(item, ['id', 'month', 'categoryId', 'limitCents'], '预算');
  for (const item of value.recurringRules)
    assertKnownKeys(
      item,
      [
        'id',
        'name',
        'kind',
        'amountCents',
        'accountId',
        'categoryId',
        'note',
        'tags',
        'frequency',
        'startAt',
        'enabled',
        'createdAt',
      ],
      '周期规则',
    );
  for (const item of value.occurrences)
    assertKnownKeys(item, ['id', 'ruleId', 'scheduledAt', 'status', 'transactionId'], '周期记录');
}
