// Re-capture stable visuals from the UI-smoke export; no application seed data is changed.
const { chromium, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const dir = path.resolve(__dirname, '../artifacts/ui');
const baseURL = process.env.QINGZHANG_TEST_URL || 'http://127.0.0.1:8084';
let browser;
async function shot(page, name) {
  await page.locator('[aria-live="polite"]').waitFor({ state: 'hidden', timeout: 7000 });
  await page.evaluate(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await Promise.all(
      document
        .getAnimations()
        .filter((a) => a.playState === 'running' && a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => {})),
    );
  });
  await page.screenshot({
    path: path.join(dir, `${name}.png`),
    fullPage: true,
    animations: 'disabled',
  });
}
async function nav(page, name) {
  await page.getByRole('tab', { name, exact: true }).click();
}
async function manage(page, name) {
  await nav(page, '我的');
  await page.getByText(name, { exact: true }).click();
}
async function restore(page) {
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('从第一笔开始', { exact: true })).toBeVisible();
  await manage(page, '备份与迁移');
  const chooser = page.waitForEvent('filechooser');
  await page.getByText('从完整备份恢复', { exact: true }).click();
  await (await chooser).setFiles(path.join(dir, 'test-ledger-final.json'));
  await page.getByRole('button', { name: '备份当前并恢复', exact: true }).click();
  await expect(page.getByText('确认恢复账本', { exact: true })).toBeHidden();
}
(async () => {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const desktop = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    timezoneId: 'Asia/Shanghai',
    locale: 'zh-CN',
  });
  const desk = await desktop.newPage();
  await restore(desk);
  await nav(desk, '首页');
  await shot(desk, '04-desktop-populated');
  await nav(desk, '统计');
  await shot(desk, '02-desktop-reports');
  await manage(desk, '我的账户');
  await shot(desk, '03-desktop-accounts');
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
    timezoneId: 'Asia/Shanghai',
    locale: 'zh-CN',
  });
  const phone = await mobile.newPage();
  await restore(phone);
  await nav(phone, '首页');
  await shot(phone, '06-mobile-home');
  await nav(phone, '统计');
  for (const period of ['每日', '每周', '每月', '每年']) {
    await phone.getByRole('button', { name: period, exact: true }).click();
    await expect(phone.getByText('44.45', { exact: true })).toBeVisible();
  }
  await phone.getByRole('button', { name: '每月', exact: true }).click();
  await shot(phone, '07-mobile-reports');
  await phone.getByLabel('记一笔', { exact: true }).click();
  await phone.getByLabel('金额', { exact: true }).fill('12.34');
  await phone.getByLabel('备注', { exact: true }).fill('一杯拿铁');
  await phone.getByLabel('金额', { exact: true }).blur();
  await shot(phone, '08-mobile-entry');
  await phone.getByLabel('关闭', { exact: true }).click();
  await manage(phone, '外观与关于');
  await phone.getByRole('button', { name: '深色', exact: true }).click();
  await nav(phone, '首页');
  await shot(phone, '09-mobile-dark');
  await phone.setViewportSize({ width: 320, height: 720 });
  await shot(phone, '10-small-dark');
  await manage(phone, '预算计划');
  await shot(phone, '10b-small-budget');
  await nav(phone, '统计');
  await phone.getByRole('button', { name: '每周', exact: true }).click();
  const previous = await phone.getByLabel('上一周期', { exact: true }).boundingBox();
  const label = await phone.getByLabel('回到当前周期', { exact: true }).boundingBox();
  const next = await phone.getByLabel('下一周期', { exact: true }).boundingBox();
  if (
    !previous ||
    !label ||
    !next ||
    label.x < previous.x + previous.width - 1 ||
    label.x + label.width > next.x + 1
  )
    throw new Error('Small-screen period label overlaps the navigation arrows');
  await shot(phone, '10c-small-week-report');
  await nav(phone, '首页');
  await phone.setViewportSize({ width: 390, height: 844 });
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
  await shot(phone, '11-mobile-large-text');
  const overflow = await phone.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
    clippedAmounts: [...document.querySelectorAll('div')].filter(
      (el) =>
        !el.children.length && el.textContent === '1,334.56' && el.scrollWidth > el.clientWidth + 1,
    ).length,
  }));
  if (overflow.scroll > overflow.client + 1 || overflow.clippedAmounts)
    throw new Error(`Enlarged text clips monetary amounts: ${JSON.stringify(overflow)}`);
  await fs.writeFile(
    path.join(dir, 'visual-report.json'),
    JSON.stringify(
      {
        passed: true,
        mobilePeriods: ['day', 'week', 'month', 'year'],
        smallScreen: '320x720',
        mobileScreen: '390x844',
        desktopScreen: '1440x1000',
        enlargedText: '135% CSS simulation; not native OS font scaling',
        clippedAmounts: overflow.clippedAmounts,
      },
      null,
      2,
    ),
  );
  console.log('Stable desktop/mobile visual captures saved.');
})()
  .catch((error) => {
    console.error(error.stack || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browser) await browser.close();
  });
