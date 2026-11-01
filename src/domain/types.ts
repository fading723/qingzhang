export type TransactionKind = 'expense' | 'income' | 'transfer' | 'refund' | 'adjustment';
export type AccountType = 'cash' | 'bank' | 'wechat' | 'alipay' | 'credit' | 'other';
export type Period = 'day' | 'week' | 'month' | 'year';
export interface Account {
  id: string;
  name: string;
  type: AccountType;
  openingBalanceCents: number;
  archived: boolean;
  createdAt: string;
}
export interface Category {
  id: string;
  name: string;
  kind: 'expense' | 'income';
  parentId: string | null;
  icon: string;
  color: string;
  sortOrder: number;
  archived: boolean;
}
export interface Transaction {
  id: string;
  kind: TransactionKind;
  amountCents: number;
  accountId: string;
  toAccountId: string | null;
  categoryId: string | null;
  refundOfId: string | null;
  occurredAt: string;
  createdAt: string;
  updatedAt: string;
  note: string;
  tags: string[];
  recurringOccurrenceId: string | null;
}
export type TransactionInput = Omit<Transaction, 'createdAt' | 'updatedAt'> & {
  createdAt?: string;
  updatedAt?: string;
};
export interface Budget {
  id: string;
  month: string;
  categoryId: string | null;
  limitCents: number;
}
export interface RecurringRule {
  id: string;
  name: string;
  kind: 'expense' | 'income';
  amountCents: number;
  accountId: string;
  categoryId: string;
  note: string;
  tags: string[];
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  startAt: string;
  enabled: boolean;
  createdAt: string;
}
export interface Occurrence {
  id: string;
  ruleId: string;
  scheduledAt: string;
  status: 'posted' | 'skipped';
  transactionId: string | null;
}
export interface Settings {
  theme: 'system' | 'light' | 'dark';
  currency: 'CNY';
  timeZone: 'Asia/Shanghai';
  lastBackupAt: string | null;
}
export interface LedgerState {
  version: 1;
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  budgets: Budget[];
  recurringRules: RecurringRule[];
  occurrences: Occurrence[];
  settings: Settings;
}
export interface TransactionFilter {
  start?: string;
  end?: string;
  kind?: TransactionKind;
  accountId?: string;
  categoryId?: string;
  minCents?: number;
  maxCents?: number;
  query?: string;
  tag?: string;
}
export interface Summary {
  incomeCents: number;
  expenseCents: number;
  refundCents: number;
  netExpenseCents: number;
  balanceCents: number;
  count: number;
}
export interface DueOccurrence {
  id: string;
  ruleId: string;
  scheduledAt: string;
  rule: RecurringRule;
}
