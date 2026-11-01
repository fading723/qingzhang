import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
import {
  applyImport,
  createBackup,
  csvTemplate,
  exportCsv,
  importPreview,
  MAX_BACKUP_BYTES,
  MAX_IMPORT_BYTES,
  parseBackup,
  parseCsv,
} from '../src/data/portable';
import { balances, summarize, validateState } from '../src/domain/ledger';
import { initialState } from '../src/domain/seed';
import type { LedgerState, Transaction } from '../src/domain/types';
import {
  initializeSqlite,
  readSqliteLedger,
  writeSqliteLedger,
  type SqliteConnection,
} from '../src/data/sqliteStorage';

const instant = '2026-04-10T04:12:00.000Z';
function transaction(patch: Partial<Transaction> = {}): Transaction {
  return {
    id: 'expense-1',
    kind: 'expense',
    amountCents: 1234,
    accountId: 'account-cash',
    toAccountId: null,
    categoryId: 'cat-food',
    refundOfId: null,
    occurredAt: instant,
    createdAt: instant,
    updatedAt: instant,
    note: '',
    tags: [],
    recurringOccurrenceId: null,
    ...patch,
  };
}
function stateWithTransactions(transactions = [transaction()]): LedgerState {
  const state = initialState();
  state.accounts.push({
    id: 'account-bank',
    name: '银行卡',
    type: 'bank',
    openingBalanceCents: 100_000,
    archived: false,
    createdAt: instant,
  });
  state.transactions = transactions;
  return state;
}

test('complete backup round-trips all entities without changing money or settings', () => {
  const state = stateWithTransactions();
  state.budgets.push({ id: 'budget', month: '2026-04', categoryId: null, limitCents: 200_000 });
  state.settings.theme = 'dark';
  const restored = parseBackup(createBackup(state));
  assert.deepEqual(restored, state);
  assert.deepEqual(balances(restored), balances(state));
  assert.deepEqual(summarize(restored.transactions), summarize(state.transactions));
});

test('damaged, foreign, newer, or reference-invalid backups are rejected', () => {
  assert.throws(() => parseBackup('{broken'), /JSON/);
  assert.throws(() => parseBackup(JSON.stringify(initialState())), /格式或版本/);
  const backup = JSON.parse(createBackup(stateWithTransactions()));
  backup.formatVersion = 2;
  assert.throws(() => parseBackup(JSON.stringify(backup)), /格式或版本/);
  backup.formatVersion = 1;
  backup.ledger.transactions[0].accountId = 'missing';
  assert.throws(() => parseBackup(JSON.stringify(backup)), /账户/);
});

test('CSV respects commas, quotes, multiline Chinese notes, tags and formula escaping', () => {
  const state = stateWithTransactions([
    transaction({ note: '=SUM(A1,A2)\n午餐 "和朋友"', tags: ['旅行', '家庭'] }),
  ]);
  const csv = exportCsv(state);
  assert.match(csv, /'=SUM/);
  assert.equal(parseCsv(csv).length, 2);
  const destination = { ...state, transactions: [] };
  const preview = importPreview(csv, destination);
  assert.deepEqual(preview.errors, []);
  assert.deepEqual(preview.rows[0].errors, []);
  const restored = applyImport(destination, preview);
  assert.equal(restored.transactions[0].note, state.transactions[0].note);
  assert.deepEqual(restored.transactions[0].tags, state.transactions[0].tags);
  assert.equal(restored.transactions[0].amountCents, 1234);
  assert.equal(restored.transactions[0].occurredAt, instant);
});

test('CSV prefixes risky spreadsheet cells and preserves parsed multiline/full-width text', () => {
  const notes = [
    '=1+1', '+1+1', '-1+1', '@SUM(A1)', '\t=1+1', '\r=1+1', '\n=1+1',
    '＝1+1', '＋1+1', '－1+1', '＠SUM(A1)', "'literal", '=1+1\",=2+2;\n备注',
  ];
  for (const note of notes) {
    const state = stateWithTransactions([transaction({ note })]);
    state.accounts[0].name = '＝账户';
    const csv = exportCsv(state);
    assert.ok(csv.includes(`"'${note.replace(/"/g, '""')}"`));
    assert.ok(csv.includes('"\'＝账户"'));
    const rows = parseCsv(csv);
    assert.equal(rows.length, 2);
    assert.equal(rows[1].length, rows[0].length);
    assert.equal(rows[1][11], note);
    const empty = { ...state, transactions: [] };
    const preview = importPreview(csv, empty);
    assert.deepEqual(preview.errors, []);
    assert.deepEqual(preview.rows[0].errors, []);
    assert.equal(preview.rows[0].transaction?.note, note);
    // The ledger intentionally trims note boundaries when applying an input.
    assert.equal(applyImport(empty, preview).transactions[0].note, note.trim());
  }
});

test('CSV import handles transfer, signed balance adjustment and refunds before expenses', () => {
  const transactions = [
    transaction({
      id: 'refund',
      kind: 'refund',
      amountCents: 234,
      refundOfId: 'expense-1',
      occurredAt: '2026-05-01T04:00:00.000Z',
    }),
    transaction(),
    transaction({
      id: 'transfer',
      kind: 'transfer',
      amountCents: 5000,
      categoryId: null,
      toAccountId: 'account-bank',
    }),
    transaction({ id: 'adjustment', kind: 'adjustment', amountCents: -100, categoryId: null }),
  ];
  const state = stateWithTransactions(transactions);
  validateState(state);
  const empty = { ...state, transactions: [] };
  const preview = importPreview(exportCsv(state), empty);
  assert.deepEqual(
    preview.rows.map((row) => row.errors),
    [[], [], [], []],
  );
  const restored = applyImport(empty, preview);
  assert.deepEqual(balances(restored), balances(state));
  assert.equal(summarize(restored.transactions).netExpenseCents, 1000);
  assert.equal(restored.transactions.find((row) => row.id === 'adjustment')!.amountCents, -100);
});

test('CSV round-trip permits referenced accounts and categories that are now archived', () => {
  const state = stateWithTransactions();
  state.accounts[0].archived = true;
  state.categories.find((category) => category.id === 'cat-food')!.archived = true;
  const empty = { ...state, transactions: [] };
  const preview = importPreview(exportCsv(state), empty);
  assert.deepEqual(preview.rows[0].errors, []);
  assert.equal(applyImport(empty, preview).transactions.length, 1);
});

test('existing IDs block all import and applyImport rechecks a stale preview', () => {
  const source = stateWithTransactions();
  const duplicate = importPreview(exportCsv(source), source);
  assert.equal(duplicate.rows[0].duplicate, true);
  assert.match(duplicate.rows[0].errors[0], /已存在/);
  assert.throws(() => applyImport(source, duplicate));
  const preview = importPreview(exportCsv(source), { ...source, transactions: [] });
  assert.throws(() => applyImport(source, preview), /已经存在/);
  assert.equal(source.transactions.length, 1);
});

test('similar but distinct payments are flagged without silently dropping either', () => {
  const state = stateWithTransactions([transaction({ occurredAt: '2026-04-10T04:12:43.000Z' })]);
  const incoming = stateWithTransactions([transaction({ id: 'expense-2' })]);
  const preview = importPreview(exportCsv(incoming), state);
  assert.equal(preview.rows[0].duplicate, true);
  assert.deepEqual(preview.rows[0].errors, []);
  assert.equal(applyImport(state, preview).transactions.length, 2);
});

test('missing accounts, bad amounts and impossible times produce row errors', () => {
  const state = stateWithTransactions();
  const template = exportCsv(state);
  const destination = { ...state, transactions: [] };
  const wrongAccount = template.replace('account-cash,现金', 'unknown,不存在');
  assert.match(importPreview(wrongAccount, destination).rows[0].errors[0], /账户/);
  const wrongAmount = template.replace(',12.34,', ',12.345,');
  assert.ok(importPreview(wrongAmount, destination).rows[0].errors.length);
  const wrongDate = template.replace('2026-04-10 12:12', '2026-02-30 12:12');
  assert.ok(importPreview(wrongDate, destination).rows[0].errors.length);
});

test('aggregate partial refunds cannot exceed the original expense', () => {
  const expense = transaction({ amountCents: 1000 });
  const source = stateWithTransactions([
    expense,
    transaction({ id: 'r1', kind: 'refund', refundOfId: expense.id, amountCents: 600 }),
    transaction({ id: 'r2', kind: 'refund', refundOfId: expense.id, amountCents: 600 }),
  ]);
  const empty = { ...source, transactions: [] };
  const preview = importPreview(exportCsv(source), empty);
  assert.match(preview.rows[2].errors[0], /累计退款/);
  assert.throws(() => applyImport(empty, preview));
  assert.equal(empty.transactions.length, 0);
});

test('CSV schema errors and unmatched quotes are reported before mutation', () => {
  assert.throws(() => parseCsv('a,b\n"unclosed'), /引号/);
  assert.throws(() => parseCsv('a,b\n"value"garbage,x'), /引号/);
  assert.ok(importPreview('金额,备注\n2,饭', initialState()).errors.length);
  assert.ok(importPreview('', initialState()).errors.length);
  const template = csvTemplate(initialState());
  const preview = importPreview(template, initialState());
  assert.equal(preview.rows.length, 1);
  assert.ok(preview.rows[0].errors.length, 'template row must require an actual amount');
});

test('CSV export does not fabricate records for an empty ledger', () => {
  assert.equal(parseCsv(exportCsv(initialState())).length, 1);
});

test('10,000-row CSV import, validation, and backup restoration stay bounded', (t) => {
  const state = stateWithTransactions(
    Array.from({ length: 10_000 }, (_, i) =>
      transaction({
        id: `batch-${i}`,
        amountCents: i + 1,
        occurredAt: new Date(Date.parse(instant) + i * 60_000).toISOString(),
      }),
    ),
  );
  const started = performance.now();
  const csv = exportCsv(state);
  const empty = { ...state, transactions: [] };
  const preview = importPreview(csv, empty);
  assert.deepEqual(preview.errors, []);
  assert.equal(preview.rows.filter((row) => row.errors.length).length, 0);
  const imported = applyImport(empty, preview);
  const restored = parseBackup(createBackup(imported));
  assert.equal(restored.transactions.length, 10_000);
  assert.deepEqual(balances(restored), balances(state));
  const elapsed = performance.now() - started;
  t.diagnostic(
    `10,000-row export + preview + import + backup roundtrip: ${Math.round(elapsed)} ms`,
  );
  assert.ok(elapsed < 8000, `10,000-row flow took ${elapsed} ms`);
});

// This adapter uses a real SQLite database. Production calls the same storage functions through expo-sqlite.
function sqliteFixture(): { connection: SqliteConnection; native: DatabaseSync } {
  const native = new DatabaseSync(':memory:');
  const connection: SqliteConnection = {
    execAsync: async (sql) => {
      native.exec(sql);
    },
    getFirstAsync: async <T>(sql: string, ...params: Array<string | number | null>) =>
      (native.prepare(sql).get(...params) as T | undefined) ?? null,
    getAllAsync: async <T>(sql: string, ...params: Array<string | number | null>) =>
      native.prepare(sql).all(...params) as T[],
    runAsync: async (sql, ...params) => native.prepare(sql).run(...params),
    prepareAsync: async (sql) => {
      const statement = native.prepare(sql);
      return {
        executeAsync: async (...params) => statement.run(...params),
        finalizeAsync: async () => undefined,
      };
    },
    withExclusiveTransactionAsync: async (callback) => {
      native.exec('BEGIN IMMEDIATE');
      try {
        await callback(connection);
        native.exec('COMMIT');
      } catch (error) {
        native.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return { connection, native };
}

test('SQLite migration, durable roundtrip and differential updates execute against real SQL', async () => {
  const { connection, native } = sqliteFixture();
  try {
    await initializeSqlite(connection);
    assert.equal(
      (native.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
      1,
    );
    assert.equal(
      (native.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys,
      1,
    );
    assert.deepEqual(await readSqliteLedger(connection), { state: null, revision: 0 });
    const state = stateWithTransactions();
    assert.equal(await writeSqliteLedger(connection, state, undefined, 0), 1);
    assert.deepEqual((await readSqliteLedger(connection)).state, state);
    const changesBefore = Number(
      (native.prepare('SELECT total_changes() AS count').get() as { count: number }).count,
    );
    const edited = { ...state, transactions: [{ ...state.transactions[0], note: '新的备注' }] };
    assert.equal(await writeSqliteLedger(connection, edited, state, 1), 2);
    const changesAfter = Number(
      (native.prepare('SELECT total_changes() AS count').get() as { count: number }).count,
    );
    assert.equal(
      changesAfter - changesBefore,
      3,
      'only changed transaction + settings + revision should be written',
    );
    assert.deepEqual((await readSqliteLedger(connection)).state, edited);
    await initializeSqlite(connection);
    assert.deepEqual(
      (await readSqliteLedger(connection)).state,
      edited,
      're-running migration must preserve the ledger',
    );
  } finally {
    native.close();
  }
});

test('SQLite write failure rolls back every entity and leaves revision unchanged', async () => {
  const { connection, native } = sqliteFixture();
  try {
    await initializeSqlite(connection);
    const state = stateWithTransactions();
    await writeSqliteLedger(connection, state, undefined, 0);
    native.exec(
      "CREATE TRIGGER deny_transaction_update BEFORE UPDATE ON transactions BEGIN SELECT RAISE(ABORT, 'simulated write failure'); END;",
    );
    const changed = {
      ...state,
      accounts: state.accounts.map((account) =>
        account.id === 'account-cash' ? { ...account, name: '不应被提交的名称' } : account,
      ),
      transactions: [{ ...state.transactions[0], amountCents: 2000 }],
    };
    await assert.rejects(
      writeSqliteLedger(connection, changed, state, 1),
      /simulated write failure/,
    );
    const stored = await readSqliteLedger(connection);
    assert.equal(stored.revision, 1);
    assert.deepEqual(
      stored.state,
      state,
      'account update must roll back along with the failed transaction update',
    );
  } finally {
    native.close();
  }
});

test('SQLite rejects stale revisions and unsupported migrations without overwriting data', async () => {
  const { connection, native } = sqliteFixture();
  try {
    await initializeSqlite(connection);
    const state = stateWithTransactions();
    await writeSqliteLedger(connection, state, undefined, 0);
    await assert.rejects(
      writeSqliteLedger(connection, { ...state, transactions: [] }, state, 0),
      /其他窗口/,
    );
    assert.deepEqual((await readSqliteLedger(connection)).state, state);
    native.exec('PRAGMA user_version = 2');
    await assert.rejects(initializeSqlite(connection), /较新版本/);
    assert.equal(
      (native.prepare('SELECT COUNT(*) AS count FROM transactions').get() as { count: number })
        .count,
      1,
    );
  } finally {
    native.close();
  }
});

test('iOS config mod injects backup exclusion before native startup and is idempotent', async () => {
  const require = createRequire(import.meta.url);
  const withLocalOnlyBackup = require('../plugins/withLocalOnlyBackup.js');
  const config = withLocalOnlyBackup({ name: '青账', slug: 'qingzhang' });
  const contents = `internal import Expo
import React
@main
class AppDelegate: ExpoAppDelegate {
  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
}`;
  const result = await config.mods.ios.appDelegate({
    ...config,
    modRequest: { platform: 'ios' },
    modResults: { language: 'swift', contents },
  });
  assert.match(result.modResults.contents, /import Foundation/);
  assert.match(result.modResults.contents, /values\.isExcludedFromBackup = true/);
  assert.match(result.modResults.contents, /applicationSupportDirectory/);
  assert.ok(
    result.modResults.contents.indexOf('values.isExcludedFromBackup') <
      result.modResults.contents.indexOf('let delegate'),
  );
  const again = await config.mods.ios.appDelegate(result);
  assert.equal(again.modResults.contents, result.modResults.contents);
  await assert.rejects(
    config.mods.ios.appDelegate({
      ...config,
      modRequest: { platform: 'ios' },
      modResults: { language: 'swift', contents: 'unsupported template' },
    }),
    /Could not locate/,
  );
});

test('SQLite refuses orphaned data in every table when settings are missing', async () => {
  for (const table of [
    'accounts',
    'categories',
    'transactions',
    'budgets',
    'recurring_rules',
    'occurrences',
    'metadata',
  ]) {
    const { connection, native } = sqliteFixture();
    try {
      await initializeSqlite(connection);
      native
        .prepare(
          table === 'metadata'
            ? 'INSERT INTO metadata (key, value) VALUES (?, ?)'
            : `INSERT INTO ${table} (id, payload) VALUES (?, ?)`,
        )
        .run('orphan', '{}');
      await assert.rejects(readSqliteLedger(connection), /设置缺失/, table);
      assert.equal(
        (native.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count,
        1,
        `${table} must remain untouched`,
      );
    } finally {
      native.close();
    }
  }
});

test('SQLite detects mismatched row identifiers and missing revision metadata', async () => {
  const { connection, native } = sqliteFixture();
  try {
    await initializeSqlite(connection);
    const state = stateWithTransactions();
    await writeSqliteLedger(connection, state, undefined, 0);
    native
      .prepare('UPDATE transactions SET id = ? WHERE id = ?')
      .run('wrong-physical-id', state.transactions[0].id);
    await assert.rejects(readSqliteLedger(connection), /标识与内容不一致/);
    native
      .prepare('UPDATE transactions SET id = ? WHERE id = ?')
      .run(state.transactions[0].id, 'wrong-physical-id');
    native.exec("DELETE FROM metadata WHERE key = 'revision'");
    await assert.rejects(readSqliteLedger(connection), /修订信息缺失/);
    assert.equal(
      (native.prepare('SELECT COUNT(*) AS count FROM transactions').get() as { count: number })
        .count,
      1,
    );
  } finally {
    native.close();
  }
});

test('a migration DDL failure rolls back earlier schema changes and user_version', async () => {
  const { connection, native } = sqliteFixture();
  try {
    native.exec(
      'CREATE TABLE unrelated (id INTEGER); CREATE INDEX budgets ON unrelated(id); INSERT INTO unrelated VALUES (42);',
    );
    await assert.rejects(initializeSqlite(connection), /index named budgets/);
    assert.equal(
      (native.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
      0,
    );
    assert.equal(
      native.prepare("SELECT name FROM sqlite_master WHERE name = 'metadata'").get(),
      undefined,
    );
    assert.equal((native.prepare('SELECT id FROM unrelated').get() as { id: number }).id, 42);
    native.exec('DROP INDEX budgets');
    await initializeSqlite(connection);
    assert.deepEqual(await readSqliteLedger(connection), { state: null, revision: 0 });
  } finally {
    native.close();
  }
});

test('offset timestamps survive backup to CSV to import without changing the instant', () => {
  const state = stateWithTransactions([
    transaction({
      occurredAt: '2026-04-10T12:12:00+08:00',
      createdAt: '2026-04-10T12:12:00+08:00',
      updatedAt: '2026-04-10T13:12:00+08:00',
    }),
  ]);
  const fromBackup = parseBackup(createBackup(state));
  const csv = exportCsv(fromBackup);
  assert.match(csv, /2026-04-10T04:12:00\.000Z/);
  const empty = { ...state, transactions: [] };
  const preview = importPreview(
    csv.replace('2026-04-10 12:12', '2026-04-10T12:12:00+08:00'),
    empty,
  );
  assert.deepEqual(preview.errors, []);
  assert.deepEqual(preview.rows[0].errors, []);
  const restored = applyImport(empty, preview);
  assert.equal(
    Date.parse(restored.transactions[0].occurredAt),
    Date.parse(state.transactions[0].occurredAt),
  );
  assert.equal(
    Date.parse(restored.transactions[0].createdAt),
    Date.parse(state.transactions[0].createdAt),
  );
  assert.equal(
    Date.parse(restored.transactions[0].updatedAt),
    Date.parse(state.transactions[0].updatedAt),
  );
});

test('backup boundaries reject unknown nested payloads and aggregate money overflow', () => {
  const clean = createBackup(stateWithTransactions());
  const deeplyNested = '{"nested":'.repeat(10_000) + 'null' + '}'.repeat(10_000);
  assert.throws(
    () => parseBackup(clean.replace('"ledger":{', `"ledger":{"unknown":${deeplyNested},`)),
    /不支持的字段/,
  );
  const polluted = JSON.parse(clean);
  Object.defineProperty(polluted.ledger.transactions[0], '__proto__', {
    value: { polluted: true },
    enumerable: true,
  });
  assert.throws(() => parseBackup(JSON.stringify(polluted)), /不支持的字段/);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  const overflow = JSON.parse(clean);
  overflow.ledger.transactions = [
    transaction({ amountCents: Number.MAX_SAFE_INTEGER }),
    transaction({ id: 'overflow', amountCents: 1 }),
  ];
  assert.throws(() => parseBackup(JSON.stringify(overflow)), /安全范围/);
});

test('special-looking IDs are safe values through backup and real SQLite storage', async () => {
  const state = stateWithTransactions([
    transaction({ id: 'constructor', accountId: '__proto__', categoryId: 'prototype' }),
  ]);
  state.accounts[0].id = '__proto__';
  state.categories.find((category) => category.id === 'cat-food')!.id = 'prototype';
  const restored = parseBackup(createBackup(state));
  assert.equal(balances(restored).__proto__, -1234);
  const { connection, native } = sqliteFixture();
  try {
    await initializeSqlite(connection);
    await writeSqliteLedger(connection, restored, undefined, 0);
    assert.deepEqual((await readSqliteLedger(connection)).state, state);
    assert.equal(({} as Record<string, unknown>).polluted, undefined);
  } finally {
    native.close();
  }
});

test('complete backups larger than the CSV cap remain restorable', () => {
  const note = '测'.repeat(1000);
  const state = stateWithTransactions(
    Array.from({ length: 9000 }, (_, i) => transaction({ id: `notes-${i}`, note })),
  );
  const backup = createBackup(state);
  const bytes = new TextEncoder().encode(backup).byteLength;
  assert.ok(bytes > MAX_IMPORT_BYTES && bytes < MAX_BACKUP_BYTES);
  const restored = parseBackup(backup);
  assert.equal(restored.transactions.length, state.transactions.length);
  assert.equal(restored.transactions[8999].note, note);
});
