import { createBackup, MAX_BACKUP_BYTES } from '../data/portable';
import type { LedgerState } from '../domain/types';

/** Browser downloads have no saved-to-disk acknowledgement; UI must explicitly confirm a completed backup. */
export async function exportText(name: string, text: string, mime: string): Promise<void> {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function pickText(): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,.json,text/csv,application/json,text/plain';
    input.style.display = 'none';
    let finished = false;
    const finish = (text: string | null, error?: Error) => {
      if (finished) return;
      finished = true;
      input.remove();
      if (error) reject(error);
      else resolve(text);
    };
    // Modern target browsers emit cancel. Focus timers can incorrectly cancel slow cloud file selections.
    input.addEventListener('cancel', () => finish(null));
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        finish(null);
        return;
      }
      if (file.size > MAX_BACKUP_BYTES) {
        finish(null, new Error('文件超过 100 MB，当前版本无法处理此文件。'));
        return;
      }
      try {
        finish(await file.text());
      } catch {
        finish(null, new Error('无法读取所选文件。'));
      }
    };
    document.body.appendChild(input);
    input.click();
  });
}

async function openSafetyDatabase(): Promise<IDBDatabase> {
  if (!globalThis.indexedDB) throw new Error('无法保存恢复前备份，已停止覆盖。');
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('qingzhang-safety', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('backups');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('无法保存恢复前备份，已停止覆盖。'));
  });
}

export async function saveSafetyBackup(state: LedgerState): Promise<string> {
  const backup = createBackup(state);
  const db = await openSafetyDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('backups', 'readwrite');
      tx.objectStore('backups').put(backup, 'latest');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(new Error('浏览器备份空间不足，已停止覆盖账本。'));
      tx.onabort = () => reject(new Error('恢复前备份中断，已停止覆盖账本。'));
    });
  } finally {
    db.close();
  }
  return '浏览器本地安全副本（可点击“找回上次恢复前的账本”）';
}

export async function readSafetyBackup(): Promise<string | null> {
  const db = await openSafetyDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('backups', 'readonly');
      const request = tx.objectStore('backups').get('latest');
      tx.oncomplete = () => resolve(typeof request.result === 'string' ? request.result : null);
      tx.onerror = () => reject(new Error('读取恢复前备份失败。'));
      tx.onabort = () => reject(new Error('读取恢复前备份中断。'));
    });
  } finally {
    db.close();
  }
}
