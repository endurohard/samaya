import { chromium } from 'playwright';
const VIEWS = ['today','profile','journal','schedule','clients','services','masters',
               'promotion','messages','salary','sales','analytics','finance','inventory','settings'];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(`[${page.url().split('#')[1]||'-'}] ${m.text().slice(0,160)}`); });
page.on('pageerror', e => errors.push(`[PAGEERROR ${page.url().split('#')[1]||'-'}] ${e.message.slice(0,160)}`));
await page.goto('http://localhost:3010/', { waitUntil: 'networkidle' });
await page.fill('#loginId', '+79286117111');
await page.fill('#loginPwd', 'Qwerty1234');
await page.click('#loginForm button[type="submit"]');
await page.waitForTimeout(2500);
for (const v of VIEWS) {
  await page.goto(`http://localhost:3010/#${v}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  // тыкаем период, если он есть в разделе — там и жили вынесенные функции
  const pill = page.locator('.period-pill, [data-period]').first();
  if (await pill.count()) { await pill.click().catch(()=>{}); await page.waitForTimeout(600); }
}
await browser.close();
const real = errors.filter(e => !/401|Unauthorized|favicon/.test(e));
console.log(real.length ? 'ОШИБКИ:\n' + [...new Set(real)].join('\n') : 'ошибок в консоли нет');
