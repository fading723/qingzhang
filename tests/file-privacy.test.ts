import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const DAY = 24 * 60 * 60 * 1000;
const EXPORT_ROOT = 'file:///cache/QingzhangExports';

// Exercise the actual native file service with a sandboxed file/share adapter.
// Device share-sheet integration still needs real iOS and Android verification.
function fixture(options: {
  share?: (uri: string) => Promise<void>;
  writeError?: Error;
  deleteError?: Error;
  available?: boolean;
  pickedUri?: string;
} = {}) {
  const files = new Map<string, string>();
  const directories = new Set<string>();
  let sequence = 0;
  let now = Date.UTC(2026, 10, 1, 0, 0);
  const uriOf = (parts: Array<string | { uri: string }>) =>
    parts.map((part) => (typeof part === 'string' ? part : part.uri).replace(/\/+$/, '')).join('/');
  class Directory {
    uri: string;
    constructor(...parts: Array<string | { uri: string }>) { this.uri = uriOf(parts); }
    get name() { return this.uri.slice(this.uri.lastIndexOf('/') + 1); }
    get exists() { return directories.has(this.uri); }
    create(options: { idempotent?: boolean } = {}) {
      if (this.exists && !options.idempotent) throw new Error('directory exists');
      directories.add(this.uri);
    }
    list() {
      const isChild = (uri: string) => uri.startsWith(`${this.uri}/`) &&
        !uri.slice(this.uri.length + 1).includes('/');
      return [
        ...[...directories].filter(isChild).map((uri) => new Directory(uri)),
        ...[...files.keys()].filter(isChild).map((uri) => new File(uri)),
      ];
    }
    delete() {
      if (options.deleteError) throw options.deleteError;
      for (const uri of files.keys()) if (uri.startsWith(`${this.uri}/`)) files.delete(uri);
      directories.delete(this.uri);
    }
  }
  class File {
    uri: string;
    constructor(...parts: Array<string | { uri: string }>) { this.uri = uriOf(parts); }
    get exists() { return files.has(this.uri); }
    get size() { return Buffer.byteLength(files.get(this.uri) ?? ''); }
    create(options: { overwrite?: boolean } = {}) {
      if (this.exists && !options.overwrite) throw new Error('file exists');
      files.set(this.uri, '');
    }
    write(text: string) {
      if (options.writeError) throw options.writeError;
      files.set(this.uri, text);
    }
    async text() { return files.get(this.uri) ?? ''; }
    delete() {
      if (options.deleteError) throw options.deleteError;
      files.delete(this.uri);
    }
  }
  const modules: Record<string, unknown> = {
    'expo-document-picker': {
      getDocumentAsync: async () => options.pickedUri
        ? { canceled: false, assets: [{ uri: options.pickedUri }] }
        : { canceled: true, assets: [] },
    },
    'expo-file-system': { Directory, File, Paths: { cache: { uri: 'file:///cache/' } } },
    'expo-sharing': {
      isAvailableAsync: async () => options.available !== false,
      shareAsync: options.share ?? (async () => {}),
    },
    '../data/portable': { MAX_BACKUP_BYTES: 100 * 1024 * 1024, createBackup: JSON.stringify },
    '../data/privateDirectory': { privateDirectory: () => new Directory('file:///private') },
    '../domain/money': { makeId: () => `test-export-${++sequence}` },
  };
  const exports: Record<string, unknown> = {};
  const source = readFileSync(resolve('src/services/files.ts'), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(compiled, {
    exports,
    Date: class extends Date { static now() { return now; } },
    require: (name: string) => {
      if (!(name in modules)) throw new Error(`Unexpected native dependency: ${name}`);
      return modules[name];
    },
  });
  return {
    service: exports as Pick<typeof import('../src/services/files'), 'exportText' | 'pickText'>,
    files,
    directories,
    now: () => now,
    advance: (duration: number) => { now += duration; },
  };
}

test('concurrent exports stay readable after native callbacks and expire on a later export', async () => {
  const pending: Array<{ uri: string; finish: () => void }> = [];
  const f = fixture({
    share: (uri) => new Promise<void>((finish) => pending.push({ uri, finish })),
  });
  f.files.set('file:///documents/user-backup.json', 'user-owned');
  const first = f.service.exportText('账本.json', 'first', 'application/json');
  const second = f.service.exportText('账本.json', 'second', 'application/json');
  await new Promise<void>((done) => setImmediate(done));
  assert.equal(pending.length, 2);
  assert.notEqual(pending[0].uri, pending[1].uri);
  assert.equal(f.files.get(pending[0].uri), 'first');
  assert.equal(f.files.get(pending[1].uri), 'second');
  pending[0].finish();
  await first;
  assert.equal(f.files.get(pending[0].uri), 'first');
  assert.equal(f.files.get(pending[1].uri), 'second');
  pending[1].finish();
  await second;
  assert.equal(f.files.get(pending[1].uri), 'second');
  f.advance(DAY + 1);
  const third = f.service.exportText('账本.json', 'third', 'application/json');
  await new Promise<void>((done) => setImmediate(done));
  assert.equal(f.files.has(pending[0].uri), false);
  assert.equal(f.files.has(pending[1].uri), false);
  assert.equal(f.files.get('file:///documents/user-backup.json'), 'user-owned');
  assert.equal(f.files.get(pending[2].uri), 'third');
  pending[2].finish();
  await third;
});

test('a failed write is cleaned before sharing and preserves the original error', async () => {
  const writingError = new Error('write failed');
  let shared = false;
  const f = fixture({ writeError: writingError, share: async () => { shared = true; } });
  await assert.rejects(f.service.exportText('账本.json', 'private ledger', 'application/json'),
    (error) => error === writingError);
  assert.equal(shared, false);
  assert.equal(f.files.size, 0);
  assert.deepEqual([...f.directories], [EXPORT_ROOT]);
});

test('an indeterminate sharing failure retains the handed-off file for delayed readers', async () => {
  const sharingError = new Error('share failed');
  const f = fixture({ share: async () => { throw sharingError; } });
  await assert.rejects(f.service.exportText('账本.json', 'private ledger', 'application/json'),
    (error) => error === sharingError);
  assert.equal(f.files.size, 1);
  assert.deepEqual([...f.files.values()], ['private ledger']);
});

test('expiration preserves active shares and counts retention from their eventual return', async () => {
  let complete!: () => void;
  let activeUri = '';
  let calls = 0;
  const f = fixture({ share: async (uri) => {
    if (calls++ === 0) {
      activeUri = uri;
      await new Promise<void>((done) => { complete = done; });
    }
  } });
  const active = f.service.exportText('账本.json', 'active export', 'application/json');
  await new Promise<void>((done) => setImmediate(done));
  f.advance(DAY + 1);
  await f.service.exportText('账本.json', 'next export', 'application/json');
  assert.equal(f.files.get(activeUri), 'active export');
  complete();
  await active;
  await f.service.exportText('账本.json', 'after return', 'application/json');
  assert.equal(f.files.get(activeUri), 'active export');
  f.advance(DAY);
  await f.service.exportText('账本.json', 'at boundary', 'application/json');
  assert.equal(f.files.get(activeUri), 'active export');
  f.advance(1);
  await f.service.exportText('账本.json', 'expired', 'application/json');
  assert.equal(f.files.has(activeUri), false);
});

test('expiration deletes only old known directories, not unknown names, files or recent copies', async () => {
  const f = fixture();
  const old = `${EXPORT_ROOT}/export-${f.now() - 2 * DAY}-known-id`;
  const recent = `${EXPORT_ROOT}/export-${f.now() - DAY}-recent-id`;
  const unknown = `${EXPORT_ROOT}/old-unversioned-directory`;
  const invalid = `${EXPORT_ROOT}/export-99999999999999999-invalid-id`;
  for (const directory of [old, recent, unknown, invalid]) {
    f.directories.add(directory);
    f.files.set(`${directory}/账本.json`, 'existing');
  }
  const unknownFile = `${EXPORT_ROOT}/export-${f.now() - 3 * DAY}-file`;
  f.files.set(unknownFile, 'not a directory');
  await f.service.exportText('账本.json', 'new copy', 'application/json');
  assert.equal(f.directories.has(old), false);
  assert.equal(f.files.has(`${old}/账本.json`), false);
  for (const directory of [recent, unknown, invalid]) {
    assert.equal(f.directories.has(directory), true);
    assert.equal(f.files.get(`${directory}/账本.json`), 'existing');
  }
  assert.equal(f.files.get(unknownFile), 'not a directory');
});

test('best-effort cleanup failures do not block new exports or mask a write error', async () => {
  const cleanupError = new Error('cleanup denied');
  const writingError = new Error('write failed');
  const completed = fixture({ deleteError: cleanupError });
  const old = `${EXPORT_ROOT}/export-${completed.now() - 2 * DAY}-known-id`;
  completed.directories.add(old);
  completed.files.set(`${old}/账本.json`, 'old');
  await completed.service.exportText('账本.json', 'private ledger', 'application/json');
  assert.equal(completed.files.get(`${old}/账本.json`), 'old');
  const failed = fixture({ deleteError: cleanupError, writeError: writingError });
  await assert.rejects(failed.service.exportText('账本.json', 'private ledger', 'application/json'),
    (error) => error === writingError);
});

test('import only deletes picker cache copies and never a selected user-owned original', async () => {
  for (const uri of ['file:///cache/picker-copy.json', 'file:///documents/original.json']) {
    const f = fixture({ pickedUri: uri });
    f.files.set(uri, 'user backup');
    assert.equal(await f.service.pickText(), 'user backup');
    assert.equal(f.files.has(uri), !uri.startsWith('file:///cache/'));
  }
});

test('unavailable sharing does not create a plaintext staging file', async () => {
  const f = fixture({ available: false });
  await assert.rejects(f.service.exportText('账本.json', 'private ledger', 'application/json'));
  assert.equal(f.files.size, 0);
  assert.equal(f.directories.size, 0);
});
