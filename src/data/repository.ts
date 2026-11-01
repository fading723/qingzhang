import * as SQLite from 'expo-sqlite';
import { initialState } from '../domain/seed';
import type { LedgerState } from '../domain/types';
import { privateDirectory } from './privateDirectory';
import { initializeSqlite, readSqliteLedger, writeSqliteLedger } from './sqliteStorage';

let database: Promise<SQLite.SQLiteDatabase> | undefined;
let revision: number | null = null;
let writeQueue: Promise<void> = Promise.resolve();

async function db(): Promise<SQLite.SQLiteDatabase> {
  if (!database)
    database = (async () => {
      const opened = await SQLite.openDatabaseAsync('qingzhang.db', {}, privateDirectory().uri);
      await initializeSqlite(opened);
      return opened;
    })().catch((error) => {
      database = undefined;
      throw error;
    });
  return database;
}

export async function loadLedger(): Promise<LedgerState> {
  const opened = await db();
  const stored = await readSqliteLedger(opened);
  revision = stored.revision;
  if (!stored.state) {
    const state = initialState();
    await persistLedger(state);
    return state;
  }
  return stored.state;
}

export function persistLedger(next: LedgerState, previous?: LedgerState): Promise<void> {
  const operation = writeQueue.then(async () => {
    const opened = await db();
    revision = await writeSqliteLedger(opened, next, previous, revision);
  });
  writeQueue = operation.catch(() => undefined);
  return operation;
}
