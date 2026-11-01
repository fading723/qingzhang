import type { LedgerState } from '../domain/types';
import { validateStoredState } from './stateShape';

type BoundValue = string | number | null;
export interface SqliteSession {
  execAsync(sql: string): Promise<void>;
  getFirstAsync<T>(sql: string, ...params: BoundValue[]): Promise<T | null>;
  getAllAsync<T>(sql: string, ...params: BoundValue[]): Promise<T[]>;
  runAsync(sql: string, ...params: BoundValue[]): Promise<unknown>;
  prepareAsync(
    sql: string,
  ): Promise<{
    executeAsync(...params: BoundValue[]): Promise<unknown>;
    finalizeAsync(): Promise<void>;
  }>;
}
export interface SqliteConnection extends SqliteSession {
  withExclusiveTransactionAsync(callback: (tx: SqliteSession) => Promise<void>): Promise<void>;
}
const collections = [
  'accounts',
  'categories',
  'transactions',
  'budgets',
  'recurringRules',
  'occurrences',
] as const;
const tableNames: Record<(typeof collections)[number], string> = {
  accounts: 'accounts',
  categories: 'categories',
  transactions: 'transactions',
  budgets: 'budgets',
  recurringRules: 'recurring_rules',
  occurrences: 'occurrences',
};

export async function initializeSqlite(db: SqliteConnection): Promise<void> {
  await db.execAsync(
    'PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;',
  );
  const version =
    (await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version'))?.user_version ?? 0;
  if (!Number.isInteger(version) || version < 0)
    throw new Error('账本数据库版本损坏，请恢复备份。');
  if (version > 1) throw new Error('账本由较新版本创建，请升级青账后打开。');
  if (version === 0)
    await db.withExclusiveTransactionAsync(async (tx) => {
      await tx.execAsync(`
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS categories (id TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS transactions (id TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS budgets (id TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS recurring_rules (id TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS occurrences (id TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL);
      PRAGMA user_version = 1;
    `);
    });
}

function validRevision(value: string | undefined): number {
  if (value !== undefined && !/^(0|[1-9]\d*)$/.test(value))
    throw new Error('账本修订信息损坏，请恢复备份。');
  const revision = Number(value ?? 0);
  if (!Number.isSafeInteger(revision) || revision < 0)
    throw new Error('账本修订信息损坏，请恢复备份。');
  return revision;
}

export async function readSqliteLedger(
  db: SqliteConnection,
): Promise<{ state: LedgerState | null; revision: number }> {
  let result: { state: LedgerState | null; revision: number } = { state: null, revision: 0 };
  await db.withExclusiveTransactionAsync(async (tx) => {
    const meta = await tx.getFirstAsync<{ value: string }>(
      "SELECT value FROM metadata WHERE key = 'settings'",
    );
    const revisionRow = await tx.getFirstAsync<{ value: string }>(
      "SELECT value FROM metadata WHERE key = 'revision'",
    );
    const revision = validRevision(revisionRow?.value);
    if (!meta) {
      const tables = ['metadata', ...Object.values(tableNames)];
      for (const table of tables) {
        const count = await tx.getFirstAsync<{ count: number }>(
          `SELECT COUNT(*) AS count FROM ${table}`,
        );
        if (count?.count) throw new Error('账本设置缺失，请恢复备份，现有记录未改变。');
      }
      result = { state: null, revision };
      return;
    }
    if (!revisionRow || revision < 1)
      throw new Error('账本修订信息缺失，请恢复备份，现有记录未改变。');
    const state = { version: 1, settings: JSON.parse(meta.value) } as LedgerState;
    for (const key of collections) {
      const rows = await tx.getAllAsync<{ id: string; payload: string }>(
        `SELECT id, payload FROM ${tableNames[key]} ORDER BY rowid`,
      );
      (state[key] as unknown[]) = rows.map((row) => {
        const item: unknown = JSON.parse(row.payload);
        if (
          !item ||
          typeof item !== 'object' ||
          Array.isArray(item) ||
          !('id' in item) ||
          item.id !== row.id
        )
          throw new Error('账本记录标识与内容不一致，请恢复备份，现有记录未改变。');
        return item;
      });
    }
    validateStoredState(state);
    result = { state, revision };
  });
  return result;
}

export async function writeSqliteLedger(
  db: SqliteConnection,
  next: LedgerState,
  previous?: LedgerState,
  expectedRevision: number | null = null,
): Promise<number> {
  validateStoredState(next);
  let committedRevision = 0;
  await db.withExclusiveTransactionAsync(async (tx) => {
    const currentRevision = validRevision(
      (
        await tx.getFirstAsync<{ value: string }>(
          "SELECT value FROM metadata WHERE key = 'revision'",
        )
      )?.value,
    );
    if (expectedRevision !== null && currentRevision !== expectedRevision)
      throw new Error('账本已在其他窗口更新，请重新打开后再保存。');
    for (const key of collections) {
      const table = tableNames[key];
      const before = new Map(
        (previous?.[key] ?? []).map((item) => [item.id, JSON.stringify(item)]),
      );
      const after = new Map(next[key].map((item) => [item.id, JSON.stringify(item)]));
      if (!previous) await tx.runAsync(`DELETE FROM ${table}`);
      else
        for (const id of before.keys())
          if (!after.has(id)) await tx.runAsync(`DELETE FROM ${table} WHERE id = ?`, id);
      const statement = await tx.prepareAsync(
        `INSERT INTO ${table} (id, payload) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload`,
      );
      try {
        for (const [id, payload] of after)
          if (before.get(id) !== payload) await statement.executeAsync(id, payload);
      } finally {
        await statement.finalizeAsync();
      }
    }
    await tx.runAsync(
      "INSERT INTO metadata (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      JSON.stringify(next.settings),
    );
    committedRevision = currentRevision + 1;
    if (!Number.isSafeInteger(committedRevision)) throw new Error('账本修订号超出支持范围。');
    await tx.runAsync(
      "INSERT INTO metadata (key, value) VALUES ('revision', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      String(committedRevision),
    );
  });
  return committedRevision;
}
