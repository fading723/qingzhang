/* Real browser acceptance checks. Run after `npm run web -- --port 8081`.
 * Uses disposable browser contexts only; never touches a user's browser profile.
 * All ledger content is entered or restored through the visible UI.
 */
const { chromium, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

const baseURL = process.env.QINGZHANG_TEST_URL || 'http://localhost:8081';
const artifactDir = path.resolve(__dirname, '../artifacts/ui');
const errors = [];
const steps = [];
let browser, activePage;
const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
const txDate = `${today}T08:30`;

async function step(name, action) {
  console.log(`CHECK ${name}`);
  await action();
  steps.push(name);
}
function recordErrors(page, name) {
  page.on('pageerror', (error) =>
    errors.push({ context: name, type: 'pageerror', message: error.message }),
  );
  page.on('console', (message) => {
    if (message.type() === 'error')
      errors.push({ context: name, type: 'console', message: message.text() });
  });
}
async function screenshot(page, name) {
  await page.locator('[aria-live="polite"]').waitFor({ state: 'hidden', timeout: 7000 });
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  await page.screenshot({
    path: path.join(artifactDir, `${name}.png`),
    fullPage: true,
    animations: 'disabled',
  });
}
async function nav(page, name) {
  await page.getByRole('tab', { name, exact: true }).click();
}
async function management(page, label) {
  await nav(page, '我的');
  await page.getByText(label, { exact: true }).click();
}
async function enter(
  page,
  { kind = '支出', amount, note, date = txDate, account, destination, category },
) {
  await page.getByLabel('记一笔', { exact: true }).click();
  await expect(page.getByText('记下这一笔', { exact: true })).toBeVisible();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: kind, exact: true }).click();
  await dialog.getByLabel('金额', { exact: true }).fill(amount);
  if (category) await dialog.getByRole('button', { name: category, exact: true }).click();
  if (account) await dialog.getByRole('button', { name: account, exact: true }).first().click();
  if (destination)
    await dialog.getByRole('button', { name: destination, exact: true }).last().click();
  await dialog.getByLabel(kind === '支出' ? '消费时间' : '发生时间', { exact: true }).fill(date);
  await dialog.getByLabel('备注', { exact: true }).fill(note);
  await dialog.getByLabel('标签', { exact: true }).fill('验收');
  await dialog.getByRole('button', { name: '保存账目', exact: true }).click();
  await expect(page.getByText('记下这一笔', { exact: true })).toBeHidden();
}
async function findBill(page, note) {
  await nav(page, '账单');
  await page.getByLabel('搜索账单', { exact: true }).fill(note);
  await expect(page.getByText('1 笔记录 · 按消费发生时间排列', { exact: true })).toBeVisible();
  await page.getByRole('button').filter({ hasText: note }).click();
  await expect(page.getByText('账目详情', { exact: true })).toBeVisible();
}
async function download(page, action, filename) {
  const promise = page.waitForEvent('download');
  await action();
  const item = await promise;
  const target = path.join(artifactDir, filename);
  await item.saveAs(target);
  return target;
}
async function upload(page, label, filename) {
  const promise = page.waitForEvent('filechooser');
  await page.getByText(label, { exact: true }).click();
  const chooser = await promise;
  await chooser.setFiles(filename);
}
async function exportBackup(page, filename) {
  await management(page, '备份与迁移');
  const saved = await download(
    page,
    () => page.getByRole('button', { name: '导出完整备份', exact: true }).click(),
    filename,
  );
  await expect(page.getByText('备份文件保存好了？', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '已保存，完成备份', exact: true }).click();
  await expect(page.getByText('备份文件保存好了？', { exact: true })).toBeHidden();
  return { file: saved, data: JSON.parse(await fs.readFile(saved, 'utf8')) };
}
async function assertNoOverflow(page, name) {
  const size = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  assert.ok(
    size.scroll <= size.width + 1,
    `${name}: horizontal page overflow ${JSON.stringify(size)}`,
  );
}

(async () => {
  await fs.mkdir(artifactDir, { recursive: true });
  browser = await chromium.launch({
    channel: process.env.QINGZHANG_BROWSER_CHANNEL || 'msedge',
    headless: true,
  });
  const desktop = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    locale: 'zh-CN',
    timezoneId: 'America/New_York',
    acceptDownloads: true,
  });
  const page = (activePage = await desktop.newPage());
  recordErrors(page, 'desktop');
  page.setDefaultTimeout(20000);
  await step('fresh empty ledger and desktop layout', async () => {
    await page.goto(baseURL, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await expect(page.getByText('生活有数，心里有底', { exact: true })).toBeVisible({
      timeout: 90000,
    });
    await expect(page.getByText('从第一笔开始', { exact: true })).toBeVisible();
    await screenshot(page, '01-desktop-empty');
    await assertNoOverflow(page, 'desktop home');
  });
  await step('expense and income with exact Beijing date and minute', async () => {
    await enter(page, { amount: '12.34', note: '验收早餐', date: txDate, category: '餐饮' });
    await enter(page, {
      kind: '收入',
      amount: '100',
      note: '验收工资',
      date: `${today}T08:45`,
      category: '工资',
    });
    await findBill(page, '验收早餐');
    await expect(page.getByText(`${today} 08:30（北京时间）`, { exact: true })).toBeVisible();
    await page.getByLabel('关闭', { exact: true }).click();
  });
  await step('edit consumption time and partial refund', async () => {
    await findBill(page, '验收早餐');
    await page.getByRole('button', { name: '编辑', exact: true }).click();
    await expect(page.getByText('编辑账目', { exact: true })).toBeVisible();
    await page.getByLabel('金额', { exact: true }).fill('13.34');
    await page.getByLabel('消费时间', { exact: true }).fill(`${today}T08:31`);
    await page.getByRole('button', { name: '保存账目', exact: true }).click();
    await expect(page.getByText('编辑账目', { exact: true })).toBeHidden();
    await findBill(page, '验收早餐');
    await page.getByRole('button', { name: '记录退款', exact: true }).click();
    await expect(page.getByText('记录退款', { exact: true })).toBeVisible();
    await page.getByLabel('金额', { exact: true }).fill('3.00');
    await page.getByLabel('发生时间', { exact: true }).fill(`${today}T09:00`);
    await page.getByLabel('备注', { exact: true }).fill('验收早餐退款');
    await page.getByRole('button', { name: '保存账目', exact: true }).click();
    await expect(page.getByText('记录退款', { exact: true })).toBeHidden();
  });
  await step('day week month year summaries agree and chart drills into bills', async () => {
    await nav(page, '统计');
    for (const period of ['每日', '每周', '每月', '每年']) {
      await page.getByRole('button', { name: period, exact: true }).click();
      await expect(page.getByText('10.34', { exact: true })).toBeVisible();
      await expect(page.getByText('100.00', { exact: true }).first()).toBeVisible();
      await expect(page.getByText('3.00', { exact: true })).toBeVisible();
      await expect(page.getByText('89.66', { exact: true })).toBeVisible();
    }
    await screenshot(page, '02-desktop-reports');
    await page.getByRole('button', { name: '每月', exact: true }).click();
    await page.getByText('查看账单  ›', { exact: true }).click();
    await expect(page.getByText('3 笔记录 · 按消费发生时间排列', { exact: true })).toBeVisible();
  });
  await step('bank and credit accounts, transfer and credit repayment', async () => {
    await management(page, '我的账户');
    for (const account of [
      { name: '验收银行卡', type: '银行卡', balance: '1000' },
      { name: '验收信用卡', type: '信用卡', balance: '-200' },
    ]) {
      await page.getByText('添加账户  ›', { exact: true }).click();
      await page.getByLabel('账户名称', { exact: true }).fill(account.name);
      await page.getByRole('button', { name: account.type, exact: true }).click();
      await page
        .getByLabel(account.type === '信用卡' ? '期初余额（欠款请填负数）' : '期初余额', {
          exact: true,
        })
        .fill(account.balance);
      await page.getByRole('button', { name: '保存账户', exact: true }).click();
      await expect(page.getByText('添加账户', { exact: true })).toBeHidden();
    }
    await enter(page, {
      amount: '20',
      note: '验收信用卡消费',
      account: '验收信用卡',
      category: '购物',
      date: `${today}T10:00`,
    });
    await enter(page, {
      kind: '转账',
      amount: '50',
      note: '验收信用卡还款',
      account: '验收银行卡',
      destination: '验收信用卡',
      date: `${today}T10:30`,
    });
    await management(page, '我的账户');
    await expect(page.getByText('950.00', { exact: true })).toBeVisible();
    await expect(page.getByText('170.00', { exact: true })).toBeVisible();
    await expect(page.getByText('869.66', { exact: true })).toBeVisible();
    await screenshot(page, '03-desktop-accounts');
    await nav(page, '统计');
    await expect(page.getByText('30.34', { exact: true })).toBeVisible();
  });
  await step('large amount can be edited without grouping separator errors', async () => {
    await enter(page, { kind: '收入', amount: '1234.56', note: '验收千元金额', category: '工资' });
    await findBill(page, '验收千元金额');
    await page.getByRole('button', { name: '编辑', exact: true }).click();
    await expect(page.getByText('编辑账目', { exact: true })).toBeVisible();
    await page.getByLabel('备注', { exact: true }).fill('验收千元金额已编辑');
    await page.getByRole('button', { name: '保存账目', exact: true }).click();
    await expect(page.getByText('编辑账目', { exact: true })).toBeHidden();
  });
  await step('monthly budget and custom child category', async () => {
    await management(page, '预算计划');
    await page.getByText('新增预算  ›', { exact: true }).click();
    await page.getByLabel('预算金额', { exact: true }).fill('100');
    await page.getByRole('button', { name: '保存预算', exact: true }).click();
    await expect(page.getByText('69.66', { exact: true })).toBeVisible();
    await management(page, '收支分类');
    await page.getByText('新增分类  ›', { exact: true }).click();
    await page.getByLabel('分类名称', { exact: true }).fill('验收早餐子类');
    await page.getByRole('button', { name: '餐饮', exact: true }).click();
    await page.getByLabel('排序（数字越小越靠前）', { exact: true }).fill('1');
    await page.getByRole('button', { name: '保存分类', exact: true }).click();
    await expect(page.getByText('验收早餐子类', { exact: true })).toBeVisible();
  });
  await step(
    'recurring bill creates one transaction only after explicit confirmation',
    async () => {
      await management(page, '周期账单');
      await page.getByText('添加账单  ›', { exact: true }).click();
      await page.getByLabel('账单名称', { exact: true }).fill('验收月度订阅');
      await page.getByLabel('每期金额', { exact: true }).fill('9.90');
      await page.getByLabel('首次发生时间', { exact: true }).fill(`${today}T00:01`);
      await page.getByRole('button', { name: '娱乐', exact: true }).click();
      await page.getByRole('button', { name: '保存周期账单', exact: true }).click();
      await expect(page.getByText('验收月度订阅', { exact: true })).toBeVisible();
      await nav(page, '首页');
      await page.getByRole('button', { name: '确认记账', exact: true }).click();
      await expect(page.getByRole('button', { name: '确认记账', exact: true })).toHaveCount(0);
    },
  );
  let backup;
  await step('backup contains exact balances and exports CSV/template', async () => {
    await management(page, '备份与迁移');
    await download(
      page,
      () => page.getByRole('button', { name: '导出完整备份', exact: true }).click(),
      'unconfirmed-backup.json',
    );
    await page.getByRole('button', { name: '还未保存', exact: true }).click();
    await expect(page.getByText('最近备份：尚未创建备份', { exact: true })).toBeVisible();
    backup = await exportBackup(page, 'test-ledger.json');
    const ledger = backup.data.ledger;
    assert.equal(ledger.transactions.length, 7);
    assert.equal(ledger.budgets.length, 1);
    assert.equal(ledger.occurrences.length, 1);
    assert.equal(
      ledger.transactions.find((t) => t.note === '验收早餐').occurredAt,
      `${today}T00:31:00.000Z`,
    );
    assert.equal(
      ledger.transactions.find((t) => t.note === '验收千元金额已编辑').amountCents,
      123456,
    );
    await download(
      page,
      () => page.getByText('导出流水 CSV', { exact: true }).click(),
      'transactions.csv',
    );
    await download(
      page,
      () => page.getByText('下载导入模板', { exact: true }).click(),
      'template.csv',
    );
  });
  await step('CSV preview, valid import, duplicate rejection and safe restore', async () => {
    const template = await fs.readFile(path.join(artifactDir, 'template.csv'), 'utf8');
    const lines = template.split(/\r?\n/);
    const cells = lines[1].split(',');
    cells[0] = 'ui-smoke-csv-row';
    cells[2] = '3.21';
    cells[11] = '验收CSV导入';
    const csvFile = path.join(artifactDir, 'import.csv');
    await fs.writeFile(csvFile, `${lines[0]}\r\n${cells.join(',')}`, 'utf8');
    await upload(page, '导入流水 CSV', csvFile);
    await expect(page.getByText('检查导入流水', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '确认导入', exact: true }).click();
    await expect(page.getByText('检查导入流水', { exact: true })).toBeHidden();
    await upload(page, '导入流水 CSV', csvFile);
    await expect(page.getByText('此记录 ID 已存在，不能重复导入。', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '确认导入', exact: true })).toBeDisabled();
    await page.getByLabel('关闭', { exact: true }).click();
    await upload(page, '从完整备份恢复', backup.file);
    await page.getByRole('button', { name: '备份当前并恢复', exact: true }).click();
    await expect(page.getByText('确认恢复账本', { exact: true })).toBeHidden();
    await page.getByText('找回恢复前的账本', { exact: true }).click();
    await expect(page.getByText('8 笔流水 · 3 个账户', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '备份当前并恢复', exact: true }).click();
    await expect(page.getByText('确认恢复账本', { exact: true })).toBeHidden();
    await findBill(page, '验收CSV导入');
    await page.getByLabel('关闭', { exact: true }).click();
  });
  await step('malformed backup rejected without changing ledger', async () => {
    const broken = path.join(artifactDir, 'invalid-backup.json');
    await fs.writeFile(broken, '{}');
    await management(page, '备份与迁移');
    await upload(page, '从完整备份恢复', broken);
    await expect(
      page.getByText('不支持此备份格式或版本，请使用青账导出的完整备份。', { exact: true }),
    ).toBeVisible();
    await expect(page.getByText('确认恢复账本', { exact: true })).toHaveCount(0);
  });
  await step('offline entry then reload persists ledger', async () => {
    await desktop.setOffline(true);
    await enter(page, { amount: '1.00', note: '验收离线记录', category: '餐饮' });
    await desktop.setOffline(false);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByText('生活有数，心里有底', { exact: true })).toBeVisible();
    await findBill(page, '验收离线记录');
    await page.getByLabel('关闭', { exact: true }).click();
    backup = await exportBackup(page, 'test-ledger-final.json');
    assert.equal(backup.data.ledger.transactions.length, 9);
    await nav(page, '首页');
    await screenshot(page, '04-desktop-populated');
  });
  await step('independent mobile context restores exported ledger', async () => {
    const mobile = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 1,
      isMobile: true,
      hasTouch: true,
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
      acceptDownloads: true,
    });
    const phone = (activePage = await mobile.newPage());
    recordErrors(phone, 'mobile');
    phone.setDefaultTimeout(20000);
    await phone.goto(baseURL, { waitUntil: 'domcontentloaded' });
    await expect(phone.getByText('从第一笔开始', { exact: true })).toBeVisible();
    await screenshot(phone, '05-mobile-empty');
    await management(phone, '备份与迁移');
    await upload(phone, '从完整备份恢复', backup.file);
    await phone.getByRole('button', { name: '备份当前并恢复', exact: true }).click();
    await expect(phone.getByText('确认恢复账本', { exact: true })).toBeHidden();
    await enter(phone, { amount: '2.34', note: '验收手机表单滚动保存', category: '餐饮' });
    await findBill(phone, '验收手机表单滚动保存');
    await expect(phone.getByText(`${today} 08:30（北京时间）`, { exact: true })).toBeVisible();
    await phone.getByLabel('关闭', { exact: true }).click();
    await nav(phone, '首页');
    await screenshot(phone, '06-mobile-home');
    await assertNoOverflow(phone, 'mobile home');
    await nav(phone, '统计');
    await screenshot(phone, '07-mobile-reports');
    await assertNoOverflow(phone, 'mobile reports');
    await phone.getByLabel('记一笔', { exact: true }).click();
    await screenshot(phone, '08-mobile-entry');
    await phone.getByLabel('关闭', { exact: true }).click();
    await management(phone, '外观与关于');
    await phone.getByRole('button', { name: '深色', exact: true }).click();
    await nav(phone, '首页');
    await screenshot(phone, '09-mobile-dark');
    await phone.setViewportSize({ width: 320, height: 720 });
    await assertNoOverflow(phone, '320px home');
    await screenshot(phone, '10-small-dark');
    await management(phone, '预算计划');
    await screenshot(phone, '10b-small-budget');
    await assertNoOverflow(phone, '320px budget');
    await nav(phone, '首页');
    await phone.setViewportSize({ width: 390, height: 844 });
    // Browser approximation only; actual OS font scaling remains a native-device acceptance item.
    await phone.evaluate(() => {
      const text = [...document.querySelectorAll('div,span,input')].filter(
        (el) =>
          !el.children.length &&
          el.textContent &&
          !getComputedStyle(el).fontFamily.toLowerCase().includes('ionicons'),
      );
      const sizes = text.map((el) => [el, parseFloat(getComputedStyle(el).fontSize)]);
      for (const [el, size] of sizes) el.style.fontSize = `${size * 1.35}px`;
    });
    await screenshot(phone, '11-mobile-large-text');
    await assertNoOverflow(phone, 'mobile enlarged text');
    await mobile.close();
    activePage = page;
  });
  const actionable = errors.filter(
    (item) =>
      !/WebSocket|ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED|Failed to load resource.*ERR_CONNECTION/.test(
        item.message,
      ),
  );
  assert.equal(actionable.length, 0, `Browser errors: ${JSON.stringify(actionable, null, 2)}`);
  console.log(`PASS ${steps.length} UI acceptance scenarios`);
  await fs.writeFile(
    path.join(artifactDir, 'report.json'),
    JSON.stringify(
      {
        passed: true,
        baseURL,
        date: today,
        steps,
        browserErrors: errors,
        notes: [
          'Browser IndexedDB UI acceptance only; native SQLite and real iOS/Android device acceptance are separate.',
          'Large text screenshot simulates 135% browser text, not native OS font scaling.',
        ],
      },
      null,
      2,
    ),
  );
})()
  .catch(async (error) => {
    console.error(error.stack || error);
    if (activePage && !activePage.isClosed()) {
      await screenshot(activePage, 'failure').catch(() => {});
      await fs
        .writeFile(
          path.join(artifactDir, 'failure-body.txt'),
          await activePage
            .locator('body')
            .innerText()
            .catch(() => ''),
        )
        .catch(() => {});
    }
    await fs
      .writeFile(
        path.join(artifactDir, 'report.json'),
        JSON.stringify(
          { passed: false, steps, error: String(error.stack || error), browserErrors: errors },
          null,
          2,
        ),
      )
      .catch(() => {});
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browser) await browser.close();
  });
