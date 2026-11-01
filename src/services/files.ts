import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { createBackup, MAX_BACKUP_BYTES } from '../data/portable';
import { privateDirectory } from '../data/privateDirectory';
import type { LedgerState } from '../domain/types';
import { makeId } from '../domain/money';

const EXPORT_RETENTION_MS = 24 * 60 * 60 * 1000;
const activeExports = new Set<string>();
const lastShareReturns = new Map<string, number>();

function pruneExpiredExports(root: Directory): void {
  try {
    const now = Date.now();
    for (const item of root.list()) {
      if (!(item instanceof Directory) || activeExports.has(item.name)) continue;
      // Only directories created by this version are ours to expire. Leave older/unknown files alone.
      const match = /^export-(\d{1,16})-[a-zA-Z0-9-]+$/.exec(item.name);
      if (!match) continue;
      const createdAt = Number(match[1]);
      if (!Number.isSafeInteger(createdAt) || createdAt <= 0) continue;
      const retainedAt = Math.max(createdAt, lastShareReturns.get(item.name) ?? 0);
      if (now - retainedAt <= EXPORT_RETENTION_MS) continue;
      try {
        item.delete();
        lastShareReturns.delete(item.name);
      } catch {
        /* Leave a busy or inaccessible private cache directory for a later export/OS cleanup. */
      }
    }
  } catch {
    /* Cache maintenance must not prevent a new export. */
  }
}

/** Resolves when the share sheet closes, including cancellation. The caller must confirm saving before marking a backup successful. */
export async function exportText(name: string, text: string, mime: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync()))
    throw new Error('此设备暂不支持文件分享，请使用支持文件保存的手机环境。');
  const safeName = name.replace(/[\\/:*?"<>|]/g, '_');
  const root = new Directory(Paths.cache, 'QingzhangExports');
  root.create({ intermediates: true, idempotent: true });
  pruneExpiredExports(root);
  // Unique directories isolate concurrent exports and let later exports expire only known copies.
  const directoryName = `export-${Date.now()}-${makeId()}`;
  const directory = new Directory(root, directoryName);
  directory.create();
  const file = new File(directory, safeName);
  let shareAttempted = false;
  activeExports.add(directoryName);
  try {
    file.create({ overwrite: false });
    await file.write(text);
    // The native callback cannot prove that a recipient has finished reading the URI.
    shareAttempted = true;
    await Sharing.shareAsync(file.uri, {
      mimeType: mime,
      dialogTitle: '保存青账文件',
      UTI: mime.includes('json') ? 'public.json' : 'public.comma-separated-values-text',
    });
  } finally {
    activeExports.delete(directoryName);
    if (shareAttempted) {
      // Keep successful, cancelled, and indeterminate shares readable for delayed recipients.
      // A later export prunes copies older than 24 hours; this is best effort, not a timer.
      lastShareReturns.set(directoryName, Date.now());
    } else {
      // We know this copy never reached the native sharing API, so it is safe to discard now.
      try {
        if (file.exists) file.delete();
        if (directory.exists) directory.delete();
      } catch {
        /* The OS or a later export may reclaim private cache files left after a failed write. */
      }
    }
  }
}

export async function pickText(): Promise<string | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: '*/*',
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled || !result.assets[0]) return null;
  const selected = result.assets[0];
  const file = new File(selected.uri);
  try {
    if ((selected.size ?? file.size) > MAX_BACKUP_BYTES || file.size > MAX_BACKUP_BYTES)
      throw new Error('文件超过 100 MB，当前版本无法处理此文件。');
    return await file.text();
  } finally {
    // DocumentPicker supplied a cached copy. Never delete a user-owned original.
    try {
      if (file.uri.startsWith(Paths.cache.uri) && file.exists) file.delete();
    } catch {
      /* A failed cache cleanup must not discard successfully read input. */
    }
  }
}

export async function saveSafetyBackup(state: LedgerState): Promise<string> {
  const directory = new Directory(privateDirectory(), 'safety-backups');
  directory.create({ intermediates: true, idempotent: true });
  // A monotonic file sequence keeps "latest" correct even if the device clock moves backwards.
  const lastSequence = directory.list().reduce((latest, item) => {
    const match = /^before-restore-(\d+)\.json$/.exec(item.name);
    return match ? Math.max(latest, Number(match[1])) : latest;
  }, 0);
  const sequence = Math.max(Date.now(), lastSequence + 1);
  if (!Number.isSafeInteger(sequence)) throw new Error('安全备份序号无效，已停止覆盖账本。');
  const name = `before-restore-${sequence}.json`;
  const file = new File(directory, `${name}.tmp`);
  file.create({ overwrite: false });
  await file.write(createBackup(state));
  if (file.size === 0) throw new Error('恢复前备份写入失败，已停止覆盖账本。');
  await file.move(new File(directory, name));
  return file.uri;
}

export async function readSafetyBackup(): Promise<string | null> {
  const directory = new Directory(privateDirectory(), 'safety-backups');
  if (!directory.exists) return null;
  const files = directory
    .list()
    .filter(
      (item): item is File => item instanceof File && /^before-restore-\d+\.json$/.test(item.name),
    );
  files.sort((a, b) => Number(b.name.match(/\d+/)![0]) - Number(a.name.match(/\d+/)![0]));
  return files[0] ? await files[0].text() : null;
}
