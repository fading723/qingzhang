import { validateState } from '../domain/ledger';
import { makeId, parseMoney } from '../domain/money';
import { isValidInstant, localDateTime, toInstant } from '../domain/time';
import type { LedgerState, Transaction, TransactionInput, TransactionKind } from '../domain/types';
import { assertKnownKeys, validateStoredState } from './stateShape';

export const MAX_IMPORT_BYTES = 25 * 1024 * 1024;
export const MAX_BACKUP_BYTES = 100 * 1024 * 1024;
const MAX_CSV_ROWS = 100_000;
export const CSV_COLUMNS = [
  '记录ID',
  '类型',
  '金额',
  '账户ID',
  '账户名称',
  '转入账户ID',
  '转入账户名称',
  '分类ID',
  '分类名称',
  '原支出ID',
  '消费时间',
  '备注',
  '标签JSON',
  '创建时间',
  '更新时间',
] as const;
const kindLabels: Record<TransactionKind, string> = {
  expense: '支出',
  income: '收入',
  transfer: '转账',
  refund: '退款',
  adjustment: '余额调整',
};
export interface ImportRow {
  row: number;
  transaction: TransactionInput | null;
  errors: string[];
  duplicate: boolean;
}
export interface ImportPreview {
  rows: ImportRow[];
  errors: string[];
}

function assertTextSize(text: string, limit = MAX_IMPORT_BYTES, label = 'CSV'): void {
  // UTF-8's upper bound is three bytes per UTF-16 code unit, but measure exactly to avoid rejecting Chinese prematurely.
  if (text.length > limit || new TextEncoder().encode(text).byteLength > limit)
    throw new Error(`${label}文件超过 ${limit / 1024 / 1024} MB，当前版本无法处理此文件。`);
}

export function createBackup(state: LedgerState): string {
  validateStoredState(state);
  const backup = JSON.stringify({
    format: 'qingzhang-backup',
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    ledger: state,
  });
  assertTextSize(backup, MAX_BACKUP_BYTES, '完整备份');
  return backup;
}

export function parseBackup(text: string): LedgerState {
  assertTextSize(text, MAX_BACKUP_BYTES, '完整备份');
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    throw new Error('备份文件不是有效的 JSON，原账本未改变。');
  }
  if (
    !raw ||
    typeof raw !== 'object' ||
    !('format' in raw) ||
    raw.format !== 'qingzhang-backup' ||
    !('formatVersion' in raw) ||
    raw.formatVersion !== 1 ||
    !('ledger' in raw)
  )
    throw new Error('不支持此备份格式或版本，请使用青账导出的完整备份。');
  assertKnownKeys(raw, ['format', 'formatVersion', 'exportedAt', 'ledger'], '备份');
  if (!('exportedAt' in raw) || !isValidInstant(raw.exportedAt))
    throw new Error('备份导出时间无效。');
  validateStoredState(raw.ledger);
  return raw.ledger;
}

// Reversible text prefixes reduce spreadsheet formula injection on the first open.
// Spreadsheet editors may remove escaping when re-saving: use JSON for faithful backups.
const unsafeCsvPrefix = /^[=+\-@\t\r\n'＝＋－＠]/u;
function escapeCell(value: string): string {
  const needsTextPrefix = unsafeCsvPrefix.test(value);
  const safe = needsTextPrefix ? `'${value}` : value;
  return needsTextPrefix || /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
function unescapeCell(value: string): string {
  return value.startsWith("'") && unsafeCsvPrefix.test(value.slice(1)) ? value.slice(1) : value;
}

export function parseCsv(text: string): string[][] {
  assertTextSize(text);
  const source = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [],
    cell = '',
    quoted = false,
    afterQuote = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          afterQuote = true;
        }
      } else cell += ch;
    } else if (ch === '"') {
      if (cell || afterQuote) throw new Error('CSV 引号格式错误，请使用青账模板。');
      quoted = true;
    } else if (ch === ',') {
      row.push(unescapeCell(cell));
      cell = '';
      afterQuote = false;
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && source[i + 1] === '\n') i++;
      row.push(unescapeCell(cell));
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
      cell = '';
      afterQuote = false;
      if (rows.length > MAX_CSV_ROWS + 1) throw new Error('单次最多导入十万条流水，请拆分文件。');
    } else {
      if (afterQuote) throw new Error('CSV 引号后的内容无效。');
      cell += ch;
    }
  }
  if (quoted) throw new Error('CSV 存在未闭合的引号。');
  row.push(unescapeCell(cell));
  if (row.some((value) => value !== '')) rows.push(row);
  if (rows.length > MAX_CSV_ROWS + 1) throw new Error('单次最多导入十万条流水，请拆分文件。');
  return rows;
}

function moneyString(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const amount = Math.abs(cents);
  return `${sign}${Math.floor(amount / 100)}.${String(amount % 100).padStart(2, '0')}`;
}

function transactionCells(state: LedgerState, tx: Transaction): string[] {
  return [
    tx.id,
    kindLabels[tx.kind],
    moneyString(tx.amountCents),
    tx.accountId,
    state.accounts.find((a) => a.id === tx.accountId)?.name ?? '',
    tx.toAccountId ?? '',
    state.accounts.find((a) => a.id === tx.toAccountId)?.name ?? '',
    tx.categoryId ?? '',
    state.categories.find((c) => c.id === tx.categoryId)?.name ?? '',
    tx.refundOfId ?? '',
    localDateTime(tx.occurredAt).replace('T', ' '),
    tx.note,
    JSON.stringify(tx.tags),
    new Date(tx.createdAt).toISOString(),
    new Date(tx.updatedAt).toISOString(),
  ];
}

export function exportCsv(state: LedgerState): string {
  return (
    '\uFEFF' +
    [
      CSV_COLUMNS.join(','),
      ...state.transactions.map((tx) => transactionCells(state, tx).map(escapeCell).join(',')),
    ].join('\r\n')
  );
}

export function csvTemplate(state: LedgerState): string {
  const account = state.accounts.find((a) => !a.archived);
  const category = state.categories.find((c) => !c.archived && c.kind === 'expense');
  const cells = [
    '',
    '支出',
    '',
    account?.id ?? '',
    account?.name ?? '',
    '',
    '',
    category?.id ?? '',
    category?.name ?? '',
    '',
    localDateTime().replace('T', ' '),
    '示例：请填写实际金额和消费时间后导入',
    '[]',
    '',
    '',
  ];
  return '\uFEFF' + [CSV_COLUMNS.join(','), cells.map(escapeCell).join(',')].join('\r\n');
}

function resolveReference<T extends { id: string; name: string }>(
  items: T[],
  id: string,
  name: string,
  label: string,
  optional = false,
): string | null {
  if (!id && !name && optional) return null;
  if (id) {
    const item = items.find((x) => x.id === id);
    if (item) return item.id;
  }
  if (name) {
    const matching = items.filter((x) => x.name === name);
    if (matching.length === 1) return matching[0].id;
    if (matching.length > 1) throw new Error(`${label}名称“${name}”不唯一，请填写正确 ID。`);
  }
  throw new Error(`找不到${label}“${name || id}”，请先在软件中创建或核对 ID。`);
}

function signature(tx: TransactionInput): string {
  return JSON.stringify([
    tx.kind,
    tx.amountCents,
    tx.accountId,
    tx.toAccountId,
    localDateTime(tx.occurredAt),
    tx.refundOfId,
  ]);
}

function mergeCandidate(state: LedgerState, inputs: TransactionInput[]): LedgerState {
  const now = new Date().toISOString();
  const merged = new Map<string, TransactionInput>(
    [...state.transactions, ...inputs].map((tx) => [tx.id, tx]),
  );
  const transactions: Transaction[] = inputs.map((input) => ({
    ...input,
    categoryId:
      input.kind === 'refund'
        ? (merged.get(input.refundOfId ?? '')?.categoryId ?? input.categoryId)
        : input.categoryId,
    occurredAt: new Date(input.occurredAt).toISOString(),
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
    note: input.note.trim(),
    tags: [...new Set(input.tags.map((tag) => tag.trim()).filter(Boolean))],
    recurringOccurrenceId: null,
  }));
  return { ...state, transactions: [...state.transactions, ...transactions] };
}

function normalizeInstant(value: string, optional = false): string | undefined {
  if (!value && optional) return undefined;
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}$/.test(value)) return toInstant(value.replace(' ', 'T'));
  if (!isValidInstant(value))
    throw new Error('时间必须为 YYYY-MM-DD HH:mm（北京时间）或带时区的标准 ISO 时间。');
  return new Date(value).toISOString();
}

export function importPreview(csv: string, state: LedgerState): ImportPreview {
  let parsed: string[][];
  try {
    parsed = parseCsv(csv);
  } catch (error) {
    return { rows: [], errors: [error instanceof Error ? error.message : 'CSV 无法读取。'] };
  }
  if (!parsed.length) return { rows: [], errors: ['CSV 文件为空。'] };
  const header = parsed[0].map((h) => h.trim());
  const missing = CSV_COLUMNS.filter((h) => !header.includes(h));
  if (missing.length || new Set(header).size !== header.length)
    return {
      rows: [],
      errors: [
        missing.length ? `缺少列：${missing.join('、')}。请使用青账模板。` : '表头存在重复列。',
      ],
    };
  const index = Object.fromEntries(CSV_COLUMNS.map((h) => [h, header.indexOf(h)])) as Record<
    (typeof CSV_COLUMNS)[number],
    number
  >;
  const existingIds = new Set(state.transactions.map((tx) => tx.id));
  const seenIds = new Set<string>();
  const signatures = new Set(state.transactions.map(signature));
  const rows: ImportRow[] = parsed.slice(1).map((values, n) => {
    const result: ImportRow = { row: n + 2, transaction: null, errors: [], duplicate: false };
    if (values.length !== header.length) {
      result.errors.push('列数不一致，请检查逗号和引号。');
      return result;
    }
    const get = (column: (typeof CSV_COLUMNS)[number]) => values[index[column]].trim();
    try {
      const rawKind = get('类型');
      const kind = (Object.keys(kindLabels) as TransactionKind[]).find(
        (k) => kindLabels[k] === rawKind || k === rawKind,
      );
      if (!kind) throw new Error('类型仅支持支出、收入、转账、退款、余额调整。');
      const accountId = resolveReference(state.accounts, get('账户ID'), get('账户名称'), '账户')!;
      const toAccountId = resolveReference(
        state.accounts,
        get('转入账户ID'),
        get('转入账户名称'),
        '转入账户',
        kind !== 'transfer',
      );
      const categoryId = resolveReference(
        state.categories,
        get('分类ID'),
        get('分类名称'),
        '分类',
        ['transfer', 'adjustment', 'refund'].includes(kind),
      );
      const tags: unknown = JSON.parse(get('标签JSON') || '[]');
      if (!Array.isArray(tags) || tags.some((t) => typeof t !== 'string'))
        throw new Error('标签JSON 必须为字符串数组，例如 ["旅行"]。');
      const tx: TransactionInput = {
        id: get('记录ID') || makeId(),
        kind,
        amountCents: parseMoney(get('金额'), kind === 'adjustment'),
        accountId,
        toAccountId,
        categoryId,
        refundOfId: get('原支出ID') || null,
        occurredAt: normalizeInstant(get('消费时间'))!,
        note: values[index['备注']],
        tags,
        recurringOccurrenceId: null,
        createdAt: normalizeInstant(get('创建时间'), true),
        updatedAt: normalizeInstant(get('更新时间'), true),
      };
      if (existingIds.has(tx.id)) {
        result.duplicate = true;
        result.errors.push('此记录 ID 已存在，不能重复导入。');
      }
      if (seenIds.has(tx.id)) {
        result.duplicate = true;
        result.errors.push('文件内记录 ID 重复。');
      }
      seenIds.add(tx.id);
      if (signatures.has(signature(tx))) result.duplicate = true;
      signatures.add(signature(tx));
      result.transaction = tx;
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : '该行数据无效。');
    }
    return result;
  });
  // The valid hot path validates a complete batch once, so 10,000 rows are linear rather than quadratic.
  // Refund order in CSV does not matter, and historical references to archived accounts remain valid.
  const validRows = rows.filter((row) => row.transaction && !row.errors.length);
  const candidate = mergeCandidate(
    state,
    validRows.map((row) => row.transaction!),
  );
  const errors: string[] = rows.length ? [] : ['CSV 中没有流水记录。'];
  try {
    validateState(candidate);
  } catch (batchError) {
    const merged = new Map(candidate.transactions.map((tx) => [tx.id, tx]));
    const refunded = new Map<string, number>();
    for (const tx of state.transactions)
      if (tx.kind === 'refund')
        refunded.set(tx.refundOfId!, (refunded.get(tx.refundOfId!) ?? 0) + tx.amountCents);
    // Only the error path does row-level diagnosis, using a tiny transaction fixture per row.
    for (const row of validRows) {
      const tx = merged.get(row.transaction!.id)!;
      const original = tx.kind === 'refund' ? merged.get(tx.refundOfId ?? '') : undefined;
      const fixture = {
        ...state,
        budgets: [],
        recurringRules: [],
        occurrences: [],
        transactions: original ? [{ ...original, recurringOccurrenceId: null }, tx] : [tx],
      };
      try {
        validateState(fixture);
        if (tx.kind === 'refund') {
          const total = (refunded.get(tx.refundOfId!) ?? 0) + tx.amountCents;
          if (!Number.isSafeInteger(total) || total > original!.amountCents)
            throw new Error('累计退款不能超过原支出金额。');
          refunded.set(tx.refundOfId!, total);
        }
      } catch (error) {
        row.errors.push(error instanceof Error ? error.message : '账目校验失败。');
      }
    }
    if (!rows.some((row) => row.errors.length))
      errors.push(batchError instanceof Error ? batchError.message : '整批账目校验失败。');
  }
  return { rows, errors };
}

export function applyImport(state: LedgerState, preview: ImportPreview): LedgerState {
  if (
    preview.errors.length ||
    !preview.rows.length ||
    preview.rows.some((r) => r.errors.length || !r.transaction)
  )
    throw new Error('导入包含错误，请修正文件后重新预览。');
  const ids = new Set(state.transactions.map((tx) => tx.id));
  for (const row of preview.rows) {
    const tx = row.transaction!;
    if (ids.has(tx.id))
      throw new Error(`第 ${row.row} 行记录已经存在，请重新预览，未导入任何流水。`);
    ids.add(tx.id);
  }
  const next = mergeCandidate(
    state,
    preview.rows.map((row) => row.transaction!),
  );
  validateState(next);
  return next;
}
