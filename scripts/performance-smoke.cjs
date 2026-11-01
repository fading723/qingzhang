/* End-to-end rendering acceptance for a 10,000-entry ledger.
 * Start the static snapshot server first: node scripts/serve-ui.cjs
 * Then: node scripts/performance-smoke.cjs
 * A disposable, headless browser receives data only through the App's backup-restore UI.
 * No normal seed, user profile, application database or public service is modified.
 */
const { chromium, expect } = require('@playwright/test');
const { register } = require('tsx/cjs/api');
register();
const { initialState } = require('../src/domain/seed.ts');
const { createBackup } = require('../src/data/portable.ts');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { createHash } = require('node:crypto');

const baseURL = process.env.QINGZHANG_TEST_URL || 'http://127.0.0.1:8084';
const artifactDir = path.resolve(__dirname, '../artifacts/performance');
const reportPath = path.resolve(__dirname, '../artifacts/performance.json');
const fixedNow = new Date().toISOString();
const minute = Math.floor(Date.parse(fixedNow) / 60_000) * 60_000;
const notePrefix = '性能流水';
const needleNote = '性能定位 05432';
const browserErrors = [];
const unexpectedRequests = [];
const measurements = {};
let browser, page;
const report = {
  passed: false,
  method:
    'End-to-end browser interaction latency through rendered UI; two animation frames after each observable result. Not a native-device benchmark.',
  source: { url: baseURL, fixedNow, node: process.versions.node },
  records: 10_000,
  viewport: { width: 1280, height: 960 },
  browserErrors,
  unexpectedRequests,
  measurements,
};

function fixture() {
  const state = initialState();
  state.transactions = Array.from({ length: 10_000 }, (_, index) => ({
    id: `performance-${String(index).padStart(5, '0')}`,
    kind: index % 10 === 0 ? 'income' : 'expense',
    amountCents: index % 10 === 0 ? 100_000 + index : 100 + (index % 3700),
    accountId: 'account-cash',
    toAccountId: null,
    categoryId: index % 10 === 0 ? 'cat-salary' : index % 3 === 0 ? 'cat-transport' : 'cat-food',
    refundOfId: null,
    occurredAt: new Date(minute - index * 3600_000).toISOString(),
    createdAt: fixedNow,
    updatedAt: fixedNow,
    note: index === 5432 ? needleNote : `${notePrefix} ${String(index).padStart(5, '0')}`,
    tags: ['性能验收'],
    recurringOccurrenceId: null,
  }));
  return state;
}

// Independent expectation calculation: Beijing calendar ranges, no app report helpers.
function expectedPeriod(transactions, period) {
  const shifted = new Date(Date.parse(fixedNow) + 8 * 3600_000);
  const startWall = new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()),
  );
  if (period === 'week')
    startWall.setUTCDate(startWall.getUTCDate() - ((startWall.getUTCDay() + 6) % 7));
  if (period === 'month') startWall.setUTCDate(1);
  if (period === 'year') startWall.setUTCMonth(0, 1);
  const endWall = new Date(startWall);
  if (period === 'day') endWall.setUTCDate(endWall.getUTCDate() + 1);
  if (period === 'week') endWall.setUTCDate(endWall.getUTCDate() + 7);
  if (period === 'month') endWall.setUTCMonth(endWall.getUTCMonth() + 1);
  if (period === 'year') endWall.setUTCFullYear(endWall.getUTCFullYear() + 1);
  const start = startWall.getTime() - 8 * 3600_000,
    end = endWall.getTime() - 8 * 3600_000;
  const selected = transactions.filter(
    (tx) => Date.parse(tx.occurredAt) >= start && Date.parse(tx.occurredAt) < end,
  );
  const income = selected
    .filter((tx) => tx.kind === 'income')
    .reduce((sum, tx) => sum + tx.amountCents, 0);
  const expense = selected
    .filter((tx) => tx.kind === 'expense')
    .reduce((sum, tx) => sum + tx.amountCents, 0);
  return {
    count: selected.length,
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
    incomeCents: income,
    expenseCents: expense,
    refundCents: 0,
    balanceCents: income - expense,
  };
}
function money(cents) {
  return `${cents < 0 ? '-' : ''}${Math.floor(Math.abs(cents) / 100).toLocaleString('en-US')}.${String(Math.abs(cents) % 100).padStart(2, '0')}`;
}
async function paint() {
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}
async function nav(name) {
  await page.getByRole('tab', { name, exact: true }).click();
}
async function screenshot(name) {
  await page.screenshot({ path: path.join(artifactDir, name), fullPage: true });
}
async function measure(name, action) {
  console.log(`PERF ${name}`);
  const start = performance.now();
  const details = await action();
  await paint();
  const latencyMs = Math.round(performance.now() - start);
  measurements[name] = { latencyMs, ...details };
  console.log(`PASS ${name}: ${latencyMs} ms`);
}

(async () => {
  await fs.mkdir(artifactDir, { recursive: true });
  const state = fixture();
  const backupPath = path.join(artifactDir, 'ten-thousand-backup.json');
  await fs.writeFile(backupPath, createBackup(state));
  try {
    const indexPath = path.resolve(__dirname, '../artifacts/ui-web/index.html');
    const index = await fs.readFile(indexPath);
    report.source.snapshotIndexSha256 = createHash('sha256').update(index).digest('hex');
    report.source.snapshotModifiedAt = (await fs.stat(indexPath)).mtime.toISOString();
    report.source.bundle = index.toString('utf8').match(/_expo\/static\/js\/web\/[^"\s]+/)?.[0];
  } catch {
    /* A caller may intentionally use a different local exported build. */
  }
  browser = await chromium.launch({
    channel: process.env.QINGZHANG_BROWSER_CHANNEL || 'msedge',
    headless: true,
  });
  report.source.browser = await browser.version();
  const context = await browser.newContext({
    viewport: report.viewport,
    locale: 'zh-CN',
    timezoneId: 'America/Los_Angeles',
  });
  page = await context.newPage();
  page.setDefaultTimeout(30_000);
  await page.clock.setFixedTime(new Date(fixedNow));
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  const origin = new URL(baseURL).origin;
  page.on('request', (request) => {
    if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== origin)
      unexpectedRequests.push(request.url());
  });
  await page.goto(baseURL, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await expect(page.getByText('从第一笔开始', { exact: true })).toBeVisible();
  await nav('我的');
  await page.getByText('备份与迁移', { exact: true }).click();
  await measure('backupSelectionAndPreview', async () => {
    const chooserReady = page.waitForEvent('filechooser');
    await page.getByText('从完整备份恢复', { exact: true }).click();
    await (await chooserReady).setFiles(backupPath);
    await expect(
      page.getByRole('dialog').getByText('10000 笔流水 · 1 个账户', { exact: true }),
    ).toBeVisible();
    return { validatedRows: 10_000 };
  });
  await measure('restoreConfirmationToRendered', async () => {
    await page.getByRole('button', { name: '备份当前并恢复', exact: true }).click();
    await expect(page.getByText('确认恢复账本', { exact: true })).toBeHidden();
    await expect(page.getByText('10000 笔流水 · 1 个账户', { exact: true })).toBeVisible();
    return { restoredRows: 10_000 };
  });
  await measure('openBillsFirstPage', async () => {
    await nav('账单');
    await expect(
      page.getByText('10000 笔记录 · 按消费发生时间排列', { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(/性能流水 00000/)).toBeVisible();
    await paint();
    const renderedRows = await page.getByText(/性能流水 \d{5}/).count();
    assert.ok(renderedRows > 0 && renderedRows <= 60, `first page mounted ${renderedRows} rows`);
    const footer = page.getByRole('button', { name: '加载更多 · 还有 9940 笔', exact: true });
    await expect(footer).toHaveCount(1);
    await screenshot('01-first-page.png');
    return { totalRows: 10_000, loadedPageSize: 60, mountedTransactionRows: renderedRows };
  });
  await measure('loadNextPage', async () => {
    const footer = page.getByRole('button', { name: '加载更多 · 还有 9940 笔', exact: true });
    await footer.scrollIntoViewIfNeeded();
    await footer.click();
    const next = page.getByRole('button', { name: '加载更多 · 还有 9880 笔', exact: true });
    await expect(next).toHaveCount(1);
    await paint();
    const renderedRows = await page.getByText(/性能流水 \d{5}/).count();
    assert.ok(renderedRows > 0 && renderedRows <= 120, `second page mounted ${renderedRows} rows`);
    return { loadedPageSize: 120, mountedTransactionRows: renderedRows, remainingRows: 9880 };
  });
  await measure('searchUniqueNote', async () => {
    await page.getByLabel('搜索账单', { exact: true }).fill(needleNote);
    await expect(page.getByText('1 笔记录 · 按消费发生时间排列', { exact: true })).toBeVisible();
    await expect(page.getByText(new RegExp(needleNote))).toBeVisible();
    await expect(page.getByRole('button', { name: /加载更多/ })).toHaveCount(0);
    await screenshot('02-search-result.png');
    return { keyword: needleNote, matchedRows: 1 };
  });
  await nav('统计');
  for (const [period, label] of [
    ['day', '每日'],
    ['week', '每周'],
    ['month', '每月'],
    ['year', '每年'],
  ]) {
    const expected = expectedPeriod(state.transactions, period);
    await measure(`report-${period}`, async () => {
      await page.getByRole('button', { name: label, exact: true }).click();
      const net = page.getByText('净支出（元）', { exact: true });
      const summary = net.locator('..').locator('..');
      await expect(
        net.locator('..').getByText(money(expected.expenseCents), { exact: true }),
      ).toBeVisible();
      await expect(
        summary.getByText(`${expected.count} 笔收支记录 · 按消费时间汇总`, { exact: true }),
      ).toBeVisible();
      for (const [title, cents] of [
        ['收入', expected.incomeCents],
        ['退款', 0],
        ['结余', expected.balanceCents],
      ]) {
        await expect(
          summary
            .getByText(title, { exact: true })
            .locator('..')
            .getByText(money(cents), { exact: true }),
        ).toBeVisible();
      }
      return { period, expected, amountsVerified: true };
    });
  }
  await screenshot('03-year-report.png');
  await measure('reloadPersistedTenThousandRows', async () => {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByText('生活有数，心里有底', { exact: true })).toBeVisible();
    await nav('账单');
    await expect(
      page.getByText('10000 笔记录 · 按消费发生时间排列', { exact: true }),
    ).toBeVisible();
    return { persistedRows: 10_000 };
  });
  assert.deepEqual(browserErrors, [], 'browser errors');
  assert.deepEqual(unexpectedRequests, [], 'app contacted an external service');
  report.passed = true;
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(`PASS 10,000-row rendering acceptance. Report: ${reportPath}`);
})()
  .catch(async (error) => {
    report.error = String(error.stack || error);
    console.error(error);
    if (page) {
      await screenshot('failure.png').catch(() => {});
      await fs
        .writeFile(
          path.join(artifactDir, 'failure-body.txt'),
          await page
            .locator('body')
            .innerText()
            .catch(() => ''),
        )
        .catch(() => {});
    }
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2)).catch(() => {});
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browser) await browser.close();
  });
