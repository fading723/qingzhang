import { validateStoredState } from './stateShape';
import { initialState } from '../domain/seed';
import type { LedgerState } from '../domain/types';

let openPromise: Promise<IDBDatabase> | undefined;
let revision: number | null = null;
let writeQueue: Promise<void> = Promise.resolve();

function openDatabase(): Promise<IDBDatabase> {
  if (!globalThis.indexedDB)
    return Promise.reject(
      new Error('浏览器无法使用本地数据库，请关闭隐私模式或使用手机 App。数据不会退回临时内存。'),
    );
  if (!openPromise)
    openPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('qingzhang-local', 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('ledger'))
          request.result.createObjectStore('ledger');
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
      request.onerror = () => reject(new Error('无法打开本地账本，请检查浏览器存储权限。'));
      request.onblocked = () => reject(new Error('请关闭其他青账窗口后重试。'));
    }).catch((error) => {
      openPromise = undefined;
      throw error;
    });
  return openPromise;
}

export async function loadLedger(): Promise<LedgerState> {
  const db = await openDatabase();
  const stored = await new Promise<{ revision: number; state: LedgerState } | undefined>(
    (resolve, reject) => {
      const transaction = db.transaction('ledger', 'readonly');
      const request = transaction.objectStore('ledger').get('current');
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(new Error('读取本地账本失败。'));
      transaction.onabort = () => reject(new Error('读取本地账本中断。'));
    },
  );
  revision = stored?.revision ?? 0;
  if (stored) {
    if (!Number.isSafeInteger(stored.revision) || stored.revision < 1)
      throw new Error('账本修订信息损坏，请恢复备份。');
    validateStoredState(stored.state);
    return stored.state;
  }
  const initial = initialState();
  await persistLedger(initial);
  return initial;
}

export function persistLedger(next: LedgerState, _previous?: LedgerState): Promise<void> {
  const operation = writeQueue.then(async () => {
    validateStoredState(next);
    const db = await openDatabase();
    const nextRevision = await new Promise<number>((resolve, reject) => {
      const tx = db.transaction('ledger', 'readwrite');
      const store = tx.objectStore('ledger');
      const read = store.get('current');
      let committed = 0;
      let errorMessage = '保存失败，可能是浏览器存储空间不足。原账本保持不变。';
      read.onsuccess = () => {
        const storedRevision = read.result?.revision ?? 0;
        if (revision !== null && storedRevision !== revision) {
          errorMessage = '账本已在其他窗口更新，请刷新页面后再保存。';
          tx.abort();
          return;
        }
        committed = storedRevision + 1;
        store.put({ revision: committed, state: next }, 'current');
      };
      tx.oncomplete = () => resolve(committed);
      tx.onerror = () => reject(new Error(errorMessage));
      tx.onabort = () => reject(new Error(errorMessage));
    });
    revision = nextRevision;
  });
  writeQueue = operation.catch(() => undefined);
  return operation;
}
