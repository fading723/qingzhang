import type {
  Account,
  Budget,
  Category,
  LedgerState,
  Summary,
  Transaction,
  TransactionFilter,
  TransactionInput,
} from './types';
import { safeAdd } from './money';
import { isValidInstant, localDateTime, periodRange, shiftPeriod } from './time';

function fail(message: string): never {
  throw new Error(message);
}
const plain = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
function text(value: unknown, field: string, max = 200, empty = false): asserts value is string {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    (!empty && !value.trim()) ||
    value.includes('\u0000')
  )
    fail(`${field}格式无效`);
}
function integer(value: unknown, field: string, positive = false): asserts value is number {
  if (!Number.isSafeInteger(value) || (positive && (value as number) <= 0))
    fail(`${field}必须为${positive ? '正' : '安全'}整数分`);
}
function date(value: unknown, field: string): asserts value is string {
  if (!isValidInstant(value)) fail(`${field}格式无效`);
}
function boolean(value: unknown, field: string): asserts value is boolean {
  if (typeof value !== 'boolean') fail(`${field}格式无效`);
}
function nullableId(value: unknown, field: string): void {
  if (value !== null) text(value, field, 256);
}
function strings(value: unknown): asserts value is string[] {
  if (!Array.isArray(value) || value.length > 30) fail('标签格式无效');
  for (const item of value) text(item, '标签', 40);
  if (new Set(value).size !== value.length) fail('标签不能重复');
}
function collection(
  value: unknown,
  name: string,
  max = 200_000,
): asserts value is Array<Record<string, unknown>> {
  if (!Array.isArray(value) || value.length > max) fail(`${name}列表格式无效`);
  const ids = new Set<string>();
  for (const item of value) {
    if (!plain(item)) fail(`${name}记录格式无效`);
    text(item.id, `${name}标识`, 256);
    if (ids.has(item.id)) fail(`${name}存在重复标识`);
    ids.add(item.id);
  }
}

/** Validate both shape and accounting invariants before accepting untrusted backups. */
export function validateState(value: unknown): asserts value is LedgerState {
  if (!plain(value) || value.version !== 1) fail('不支持的备份版本');
  collection(value.accounts, '账户', 1_000);
  collection(value.categories, '分类', 5_000);
  collection(value.transactions, '流水');
  collection(value.budgets, '预算', 50_000);
  collection(value.recurringRules, '周期规则', 1_000);
  collection(value.occurrences, '周期记录');
  if (!plain(value.settings)) fail('设置格式无效');
  if (
    !['system', 'light', 'dark'].includes(value.settings.theme as string) ||
    value.settings.currency !== 'CNY' ||
    value.settings.timeZone !== 'Asia/Shanghai'
  )
    fail('账本设置不受支持');
  if (value.settings.lastBackupAt !== null) date(value.settings.lastBackupAt, '备份时间');

  const accountMap = new Map(value.accounts.map((item) => [item.id, item]));
  const accountNames = new Set<string>();
  for (const item of value.accounts) {
    text(item.name, '账户名称', 80);
    boolean(item.archived, '账户状态');
    date(item.createdAt, '账户创建时间');
    integer(item.openingBalanceCents, '期初余额');
    if (!['cash', 'bank', 'wechat', 'alipay', 'credit', 'other'].includes(item.type as string))
      fail('账户类型无效');
    const nameKey = item.name.trim().toLocaleLowerCase();
    if (accountNames.has(nameKey)) fail('账户名称不能重复');
    accountNames.add(nameKey);
  }
  const categoryMap = new Map(value.categories.map((item) => [item.id, item]));
  const categoryNames = new Set<string>();
  for (const item of value.categories) {
    text(item.name, '分类名称', 40);
    text(item.icon, '分类图标', 80);
    text(item.color, '分类颜色', 30);
    if (!/^#[0-9a-fA-F]{6}$/.test(item.color)) fail('分类颜色必须为十六进制颜色');
    boolean(item.archived, '分类状态');
    integer(item.sortOrder, '分类排序');
    nullableId(item.parentId, '父分类');
    if (item.kind !== 'expense' && item.kind !== 'income') fail('分类类型无效');
    if (item.parentId !== null) {
      const parent = categoryMap.get(item.parentId);
      if (!parent || parent.id === item.id || parent.parentId !== null || parent.kind !== item.kind)
        fail('分类只能有两级且父子类型必须一致');
      if (parent.archived && !item.archived) fail('停用分类下的子分类也必须停用');
    }
    const nameKey = `${item.kind}|${item.parentId}|${item.name.trim().toLocaleLowerCase()}`;
    if (categoryNames.has(nameKey)) fail('同级分类名称不能重复');
    categoryNames.add(nameKey);
  }
  const transactionMap = new Map(value.transactions.map((item) => [item.id, item]));
  const refunded = new Map<string, number>();
  for (const item of value.transactions) {
    if (!['expense', 'income', 'transfer', 'refund', 'adjustment'].includes(item.kind as string))
      fail('流水类型无效');
    integer(item.amountCents, '流水金额', item.kind !== 'adjustment');
    if (item.amountCents === 0) fail('流水金额不能为零');
    text(item.accountId, '账户标识', 256);
    nullableId(item.toAccountId, '转入账户');
    nullableId(item.categoryId, '分类');
    nullableId(item.refundOfId, '原支出');
    nullableId(item.recurringOccurrenceId, '周期记录');
    date(item.occurredAt, '发生时间');
    date(item.createdAt, '创建时间');
    date(item.updatedAt, '更新时间');
    if (Date.parse(item.updatedAt) < Date.parse(item.createdAt)) fail('更新时间不能早于创建时间');
    text(item.note, '备注', 2_000, true);
    strings(item.tags);
    if (!accountMap.has(item.accountId)) fail('流水引用了不存在的账户');
    if (item.kind === 'transfer') {
      if (
        !item.toAccountId ||
        !accountMap.has(item.toAccountId) ||
        item.accountId === item.toAccountId
      )
        fail('转入和转出账户必须存在且不同');
    } else if (item.toAccountId !== null) fail('非转账流水不能设置转入账户');
    if (item.kind === 'expense' || item.kind === 'income') {
      const category = categoryMap.get(item.categoryId);
      if (!category || category.kind !== item.kind) fail('流水分类与收支类型不匹配');
    } else if (item.kind !== 'refund' && item.categoryId !== null)
      fail('转账和余额调整不应设置收支分类');
    if (item.kind === 'refund') {
      const original = transactionMap.get(item.refundOfId);
      if (!original || original.kind !== 'expense' || original.categoryId !== item.categoryId)
        fail('退款必须关联原支出并使用原分类');
      if (Date.parse(item.occurredAt) < Date.parse(original.occurredAt as string))
        fail('退款时间不能早于原消费时间');
      refunded.set(
        original.id as string,
        safeAdd(refunded.get(original.id as string) ?? 0, item.amountCents),
      );
    } else if (item.refundOfId !== null) fail('非退款流水不能关联原支出');
    if (item.recurringOccurrenceId !== null && item.kind !== 'expense' && item.kind !== 'income')
      fail('周期账单仅支持收入和支出');
  }
  for (const [id, amount] of refunded)
    if (amount > (transactionMap.get(id)!.amountCents as number))
      fail('累计退款不能超过原支出金额');

  const budgetKeys = new Set<string>();
  for (const item of value.budgets) {
    if (
      typeof item.month !== 'string' ||
      !/^\d{4}-(0[1-9]|1[0-2])$/.test(item.month) ||
      item.month.startsWith('0000')
    )
      fail('预算月份格式无效');
    nullableId(item.categoryId, '预算分类');
    integer(item.limitCents, '预算金额', true);
    if (item.categoryId !== null && categoryMap.get(item.categoryId)?.kind !== 'expense')
      fail('预算必须使用支出分类');
    const key = `${item.month}|${item.categoryId}`;
    if (budgetKeys.has(key)) fail('同月同分类预算不能重复');
    budgetKeys.add(key);
  }

  const ruleMap = new Map(value.recurringRules.map((item) => [item.id, item]));
  for (const item of value.recurringRules) {
    text(item.name, '周期账单名称', 80);
    text(item.note, '周期备注', 2_000, true);
    strings(item.tags);
    if (item.kind !== 'income' && item.kind !== 'expense') fail('周期账单类型无效');
    if (!['daily', 'weekly', 'monthly', 'yearly'].includes(item.frequency as string))
      fail('周期频率无效');
    text(item.accountId, '周期账户', 256);
    text(item.categoryId, '周期分类', 256);
    integer(item.amountCents, '周期金额', true);
    date(item.startAt, '周期开始时间');
    date(item.createdAt, '周期创建时间');
    boolean(item.enabled, '周期状态');
    const account = accountMap.get(item.accountId);
    const category = categoryMap.get(item.categoryId);
    if (!account || !category || category.kind !== item.kind)
      fail('周期账单引用不存在或不匹配的账户与分类');
    if (item.enabled && (account.archived || category.archived))
      fail('周期账单不能使用停用的账户或分类');
  }
  const occurrenceMap = new Map(value.occurrences.map((item) => [item.id, item]));
  const occurrenceKeys = new Set<string>();
  for (const item of value.occurrences) {
    text(item.ruleId, '周期规则标识', 256);
    date(item.scheduledAt, '计划时间');
    nullableId(item.transactionId, '周期流水');
    if (item.status !== 'posted' && item.status !== 'skipped') fail('周期记录状态无效');
    const rule = ruleMap.get(item.ruleId);
    if (!rule) fail('周期记录引用不存在的规则');
    const key = `${item.ruleId}@${new Date(item.scheduledAt).toISOString()}`;
    if (item.id !== key || occurrenceKeys.has(key)) fail('周期记录标识重复或无效');
    occurrenceKeys.add(key);
    const startLocal = localDateTime(rule.startAt as string);
    const scheduledLocal = localDateTime(item.scheduledAt);
    const startTime = Date.parse(rule.startAt as string);
    const scheduledTime = Date.parse(item.scheduledAt);
    let index: number;
    let period: 'day' | 'week' | 'month' | 'year';
    if (rule.frequency === 'daily' || rule.frequency === 'weekly') {
      period = rule.frequency === 'daily' ? 'day' : 'week';
      index = (scheduledTime - startTime) / (86_400_000 * (period === 'week' ? 7 : 1));
    } else if (rule.frequency === 'monthly') {
      period = 'month';
      index =
        (+scheduledLocal.slice(0, 4) - +startLocal.slice(0, 4)) * 12 +
        +scheduledLocal.slice(5, 7) -
        +startLocal.slice(5, 7);
    } else {
      period = 'year';
      index = +scheduledLocal.slice(0, 4) - +startLocal.slice(0, 4);
    }
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      Date.parse(shiftPeriod(rule.startAt as string, period, index)) !== scheduledTime
    )
      fail('周期记录时间不符合规则');
    if (item.status === 'posted') {
      const tx = transactionMap.get(item.transactionId);
      if (!tx || tx.recurringOccurrenceId !== item.id) fail('周期记录与生成流水关联不一致');
    } else if (item.transactionId !== null) fail('已跳过的周期不能关联流水');
  }
  for (const item of value.transactions) {
    if (item.recurringOccurrenceId !== null) {
      const occurrence = occurrenceMap.get(item.recurringOccurrenceId);
      if (!occurrence || occurrence.status !== 'posted' || occurrence.transactionId !== item.id)
        fail('流水缺少对应周期记录');
    }
  }
  // Also reject data whose balances or summaries cannot be represented exactly.
  balances(value as unknown as LedgerState);
  summarize(value.transactions as unknown as Transaction[]);
}

function ready<T extends LedgerState>(state: T): T {
  validateState(state);
  return state;
}

export function saveTransaction(state: LedgerState, input: TransactionInput): LedgerState {
  const old = state.transactions.find((item) => item.id === input.id);
  const account = state.accounts.find((item) => item.id === input.accountId);
  if (!account || (account.archived && old?.accountId !== account.id)) fail('请选择可用账户');
  if (input.kind === 'transfer') {
    const destination = state.accounts.find((item) => item.id === input.toAccountId);
    if (!destination || (destination.archived && old?.toAccountId !== destination.id))
      fail('请选择可用转入账户');
  }
  const original =
    input.kind === 'refund'
      ? state.transactions.find((item) => item.id === input.refundOfId)
      : undefined;
  if (input.kind === 'refund' && original?.kind !== 'expense') fail('找不到退款对应的原支出');
  const categoryId = input.kind === 'refund' ? original!.categoryId : input.categoryId;
  if (input.kind === 'income' || input.kind === 'expense') {
    const category = state.categories.find((item) => item.id === categoryId);
    if (!category || (category.archived && old?.categoryId !== category.id)) fail('请选择可用分类');
  }
  const now = new Date().toISOString();
  const tx: Transaction = {
    ...input,
    categoryId,
    note: input.note.trim(),
    tags: [...new Set(input.tags.map((item) => item.trim()).filter(Boolean))],
    occurredAt: isValidInstant(input.occurredAt)
      ? new Date(input.occurredAt).toISOString()
      : input.occurredAt,
    createdAt: old?.createdAt ?? input.createdAt ?? now,
    updatedAt: now,
  };
  if (old && old.recurringOccurrenceId !== tx.recurringOccurrenceId) fail('不能修改流水的周期关联');
  let transactions = old
    ? state.transactions.map((item) => (item.id === tx.id ? tx : item))
    : [...state.transactions, tx];
  // A recategorized purchase carries its linked refunds into the same category.
  if (old?.kind === 'expense' && tx.kind === 'expense' && old.categoryId !== tx.categoryId) {
    transactions = transactions.map((item) =>
      item.refundOfId === tx.id ? { ...item, categoryId: tx.categoryId, updatedAt: now } : item,
    );
  }
  return ready({ ...state, transactions });
}

export function deleteTransaction(state: LedgerState, id: string): LedgerState {
  if (state.transactions.some((item) => item.refundOfId === id))
    fail('请先删除关联退款，再删除原支出');
  return ready({
    ...state,
    transactions: state.transactions.filter((item) => item.id !== id),
    occurrences: state.occurrences.map((item) =>
      item.transactionId === id
        ? { ...item, transactionId: null, status: 'skipped' as const }
        : item,
    ),
  });
}

export function saveAccount(state: LedgerState, account: Account): LedgerState {
  const normalized = { ...account, name: account.name.trim() };
  if (
    state.accounts.some(
      (item) =>
        item.id !== account.id &&
        item.name.trim().toLocaleLowerCase() === normalized.name.toLocaleLowerCase(),
    )
  )
    fail('账户名称已存在');
  const accounts = state.accounts.some((item) => item.id === account.id)
    ? state.accounts.map((item) => (item.id === account.id ? normalized : item))
    : [...state.accounts, normalized];
  return ready({
    ...state,
    accounts,
    recurringRules: account.archived
      ? state.recurringRules.map((item) =>
          item.accountId === account.id ? { ...item, enabled: false } : item,
        )
      : state.recurringRules,
  });
}

export function saveCategory(state: LedgerState, category: Category): LedgerState {
  const normalized = { ...category, name: category.name.trim() };
  let categories = state.categories.some((item) => item.id === category.id)
    ? state.categories.map((item) => (item.id === category.id ? normalized : item))
    : [...state.categories, normalized];
  if (category.archived)
    categories = categories.map((item) =>
      item.parentId === category.id ? { ...item, archived: true } : item,
    );
  const inactive = new Set(categories.filter((item) => item.archived).map((item) => item.id));
  return ready({
    ...state,
    categories,
    recurringRules: state.recurringRules.map((item) =>
      inactive.has(item.categoryId) ? { ...item, enabled: false } : item,
    ),
  });
}

export function saveBudget(state: LedgerState, budget: Budget): LedgerState {
  return ready({
    ...state,
    budgets: state.budgets.some((item) => item.id === budget.id)
      ? state.budgets.map((item) => (item.id === budget.id ? budget : item))
      : [...state.budgets, budget],
  });
}

export function balances(state: LedgerState): Record<string, number> {
  const result: Record<string, number> = Object.create(null);
  for (const account of state.accounts) result[account.id] = account.openingBalanceCents;
  for (const item of state.transactions) {
    const direction = item.kind === 'expense' || item.kind === 'transfer' ? -1 : 1;
    result[item.accountId] = safeAdd(result[item.accountId] ?? 0, direction * item.amountCents);
    if (item.kind === 'transfer' && item.toAccountId)
      result[item.toAccountId] = safeAdd(result[item.toAccountId] ?? 0, item.amountCents);
  }
  Object.values(result).reduce((sum, amount) => safeAdd(sum, amount), 0);
  return result;
}

function selectedCategoryIds(state: LedgerState, id: string): Set<string> {
  return new Set([
    id,
    ...state.categories.filter((item) => item.parentId === id).map((item) => item.id),
  ]);
}

export function filterTransactions(
  state: LedgerState,
  filter: TransactionFilter = {},
): Transaction[] {
  const categoryIds = filter.categoryId ? selectedCategoryIds(state, filter.categoryId) : null;
  const start = filter.start ? Date.parse(filter.start) : -Infinity;
  const end = filter.end ? Date.parse(filter.end) : Infinity;
  if (Number.isNaN(start) || Number.isNaN(end)) fail('筛选时间无效');
  const query = filter.query?.trim().toLocaleLowerCase();
  const categories = new Map(state.categories.map((item) => [item.id, item.name]));
  const accounts = new Map(state.accounts.map((item) => [item.id, item.name]));
  return state.transactions
    .filter((item) => {
      const time = Date.parse(item.occurredAt);
      if (time < start || time >= end) return false;
      if (filter.kind && item.kind !== filter.kind) return false;
      if (
        filter.accountId &&
        item.accountId !== filter.accountId &&
        item.toAccountId !== filter.accountId
      )
        return false;
      if (categoryIds && (!item.categoryId || !categoryIds.has(item.categoryId))) return false;
      if (filter.minCents !== undefined && Math.abs(item.amountCents) < filter.minCents)
        return false;
      if (filter.maxCents !== undefined && Math.abs(item.amountCents) > filter.maxCents)
        return false;
      if (filter.tag && !item.tags.includes(filter.tag)) return false;
      if (
        query &&
        ![
          item.note,
          ...item.tags,
          categories.get(item.categoryId ?? ''),
          accounts.get(item.accountId),
          accounts.get(item.toAccountId ?? ''),
        ]
          .filter(Boolean)
          .join(' ')
          .toLocaleLowerCase()
          .includes(query)
      )
        return false;
      return true;
    })
    .sort(
      (a, b) =>
        Date.parse(b.occurredAt) - Date.parse(a.occurredAt) ||
        Date.parse(b.createdAt) - Date.parse(a.createdAt) ||
        a.id.localeCompare(b.id),
    );
}

export function summarize(transactions: Transaction[]): Summary {
  let incomeCents = 0;
  let expenseCents = 0;
  let refundCents = 0;
  for (const item of transactions) {
    if (item.kind === 'income') incomeCents = safeAdd(incomeCents, item.amountCents);
    if (item.kind === 'expense') expenseCents = safeAdd(expenseCents, item.amountCents);
    if (item.kind === 'refund') refundCents = safeAdd(refundCents, item.amountCents);
  }
  const netExpenseCents = safeAdd(expenseCents, -refundCents);
  return {
    incomeCents,
    expenseCents,
    refundCents,
    netExpenseCents,
    balanceCents: safeAdd(incomeCents, -netExpenseCents),
    count: transactions.length,
  };
}

export function categoryTotals(
  state: LedgerState,
  transactions: Transaction[],
  kind: 'expense' | 'income' = 'expense',
): Array<{ categoryId: string; name: string; amountCents: number; color: string; icon: string }> {
  const categories = new Map(state.categories.map((item) => [item.id, item]));
  const totals = new Map<string, number>();
  for (const item of transactions) {
    if (item.kind !== kind || !item.categoryId) continue;
    const category = categories.get(item.categoryId);
    if (!category) continue;
    const id = category.parentId ?? category.id;
    totals.set(id, safeAdd(totals.get(id) ?? 0, item.amountCents));
  }
  return [...totals]
    .map(([categoryId, amountCents]) => {
      const category = categories.get(categoryId)!;
      return {
        categoryId,
        name: category.name,
        amountCents,
        color: category.color,
        icon: category.icon,
      };
    })
    .sort((a, b) => b.amountCents - a.amountCents || a.name.localeCompare(b.name));
}

export function budgetProgress(
  state: LedgerState,
  budget: Budget,
): { spentCents: number; remainingCents: number; ratio: number } {
  const range = periodRange('month', `${budget.month}-01`);
  const rows = filterTransactions(state, {
    start: range.start,
    end: range.end,
    categoryId: budget.categoryId ?? undefined,
  });
  const spentCents = summarize(rows).netExpenseCents;
  return {
    spentCents,
    remainingCents: safeAdd(budget.limitCents, -spentCents),
    ratio: Math.max(0, spentCents / budget.limitCents),
  };
}
