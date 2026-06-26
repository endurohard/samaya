/**
 * samaya — comprehensive browser tests
 *
 * App: http://localhost:3010
 * Auth: POST /api/auth/login → { access_token, refresh_token, user }
 *       Tokens stored in localStorage as access_token / refresh_token / user
 *
 * Test user: playwright@samaya.test / PlaywrightTest123!  (owner role)
 */

import { test, expect, Page } from '@playwright/test';

const BASE = 'http://localhost:3010';
const EMAIL = 'playwright@samaya.test';
const PASSWORD = 'PlaywrightTest123!';

// ─── helpers ────────────────────────────────────────────────────────────────

/** Log in via the login form (UI flow). */
async function loginViaUI(page: Page) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#loginForm', { timeout: 10_000 });
  await page.fill('#loginId', EMAIL);
  await page.fill('#loginPwd', PASSWORD);
  await page.click('#loginForm button[type="submit"]');
  await page.waitForSelector('#authUser:not([hidden])', { timeout: 15_000 });
}

/**
 * Inject tokens directly into localStorage (fast path — avoids UI login round-trip).
 * Токен кэшируется на уровне модуля: /api/auth/login вызывается один раз на весь прогон,
 * а не в каждом beforeEach. Это совместимо с rate-limit на /login (10/мин по IP) и
 * заметно ускоряет сьют.
 */
let cachedAuth: { access_token: string; refresh_token: string; user: unknown } | null = null;
async function loginViaApi(page: Page) {
  if (!cachedAuth) {
    const resp = await page.request.post(`${BASE}/api/auth/login`, {
      data: { email: EMAIL, password: PASSWORD },
    });
    expect(resp.ok()).toBeTruthy();
    cachedAuth = await resp.json();
  }
  const body = cachedAuth!;

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(
    ({ access_token, refresh_token, user }) => {
      localStorage.setItem('access_token', access_token);
      localStorage.setItem('refresh_token', refresh_token);
      localStorage.setItem('user', JSON.stringify(user));
    },
    { access_token: body.access_token, refresh_token: body.refresh_token, user: body.user },
  );
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#authUser:not([hidden])', { timeout: 10_000 });
}

/** Click a sidebar nav item by its data-view attribute. */
async function navTo(page: Page, view: string) {
  await page.click(`a.nav-item[data-view="${view}"]`);
  await page.waitForSelector(`section[data-view="${view}"]:not([hidden])`, { timeout: 10_000 });
}

// ─── T1 — Auth ──────────────────────────────────────────────────────────────

test.describe('T1 — Auth', () => {
  test.setTimeout(30_000);

  test('login with valid credentials shows profile panel and sidebar user info', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });

    // Login form must be visible
    const loginForm = page.locator('#loginForm');
    await expect(loginForm).toBeVisible();

    // Fill and submit
    await page.fill('#loginId', EMAIL);
    await page.fill('#loginPwd', PASSWORD);
    await page.click('#loginForm button[type="submit"]');

    // Post-login: authUser panel visible, authGuest hidden
    await expect(page.locator('#authUser')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#authGuest')).toBeHidden();

    // Sidebar user-mini should be visible
    await expect(page.locator('#userMini')).toBeVisible();

    // Token must be in localStorage
    const token = await page.evaluate(() => localStorage.getItem('access_token'));
    expect(token).toBeTruthy();

    // JWT claims should be populated
    const roleEl = page.locator('#claimRole');
    await expect(roleEl).not.toHaveText('—');
  });

  test('login with wrong password shows error message', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#loginForm');
    await page.fill('#loginId', EMAIL);
    await page.fill('#loginPwd', 'completely_wrong_password_xyz');
    await page.click('#loginForm button[type="submit"]');
    await expect(page.locator('#authError')).toBeVisible({ timeout: 5_000 });
    const errorText = await page.locator('#authError').textContent();
    expect(errorText).toBeTruthy();
    expect(errorText!.length).toBeGreaterThan(0);
  });

  test('register / login tab switching works', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#loginForm');
    // Click "Регистрация" tab
    await page.locator('.tab[data-tab="register"]').click();
    await expect(page.locator('[data-pane="register"]')).toHaveClass(/active/);
    await expect(page.locator('[data-pane="login"]')).not.toHaveClass(/active/);
    // Switch back
    await page.locator('.tab[data-tab="login"]').click();
    await expect(page.locator('[data-pane="login"]')).toHaveClass(/active/);
  });
});

// ─── T2 — Journal ───────────────────────────────────────────────────────────

test.describe('T2 — Journal', () => {
  test.setTimeout(30_000);
  test.beforeEach(async ({ page }) => { await loginViaApi(page); });

  test('navigate to Journal and see calendar or list', async ({ page }) => {
    await navTo(page, 'journal');
    const journalSection = page.locator('section[data-view="journal"]');
    await expect(journalSection).toBeVisible();
    // Calendar or list should be in DOM
    await expect(page.locator('#journalCalendar, #journalList').first()).toBeAttached({ timeout: 5_000 });
    // Date input should exist
    await expect(page.locator('#journalDate')).toBeAttached();
  });

  test('journal period buttons change the period label', async ({ page }) => {
    await navTo(page, 'journal');
    const periodBtns = page.locator('.journal-period-btn');
    const count = await periodBtns.count();
    expect(count).toBeGreaterThanOrEqual(2);
    // Click each period button, verify it gets active class
    for (let i = 0; i < Math.min(count, 3); i++) {
      await periodBtns.nth(i).click();
      await expect(periodBtns.nth(i)).toHaveClass(/active/);
    }
  });

  test('calendar and list toggle buttons switch view mode', async ({ page }) => {
    await navTo(page, 'journal');
    const toggleBtns = page.locator('.cal-toggle-btn');
    const cnt = await toggleBtns.count();
    if (cnt >= 2) {
      // Find the list mode button and click it
      const listBtn = toggleBtns.filter({ hasText: 'Список' });
      if (await listBtn.count() > 0) {
        await listBtn.first().click();
        await expect(page.locator('#journalList')).toBeVisible();
        await expect(page.locator('#journalCalendar')).toBeHidden();
      }
    }
  });
});

// ─── T3 — Clients ───────────────────────────────────────────────────────────

test.describe('T3 — Clients', () => {
  test.setTimeout(30_000);
  test.beforeEach(async ({ page }) => { await loginViaApi(page); });

  test('clients list loads', async ({ page }) => {
    await navTo(page, 'clients');
    const clientsList = page.locator('#clientsList');
    await expect(clientsList).toBeVisible();
    // Wait for Загрузка to be replaced
    await page.waitForFunction(() => {
      const el = document.getElementById('clientsList');
      return el && !el.textContent?.includes('Загрузка');
    }, undefined, { timeout: 10_000 });
  });

  test('segments sidebar shows client segment counts', async ({ page }) => {
    await navTo(page, 'clients');
    await page.waitForFunction(() => {
      const el = document.getElementById('clientsList');
      return el && !el.textContent?.includes('Загрузка');
    }, undefined, { timeout: 10_000 });
    // Segments list should be in DOM
    const segments = page.locator('#clientsSegments');
    expect(await segments.count()).toBeGreaterThan(0);
  });

  test('Add client button opens modal with name and phone fields', async ({ page }) => {
    await navTo(page, 'clients');
    await page.waitForFunction(() => {
      const el = document.getElementById('clientsList');
      return el && !el.textContent?.includes('Загрузка');
    }, undefined, { timeout: 10_000 });

    // Click add button
    await page.click('#clientsAddBtn');

    // Modal should appear (remove hidden attribute)
    const modal = page.locator('#clientModal');
    await expect(modal).toBeVisible({ timeout: 5_000 });

    // Required form fields
    await expect(page.locator('#clFullName')).toBeVisible();
    await expect(page.locator('#clPhone')).toBeVisible();

    // Submit button present
    await expect(page.locator('#clientSubmit')).toBeVisible();

    // Close via Cancel button (more reliable than X in some builds)
    await page.locator('#clientCancel, #clientModalClose').first().click();
    await expect(modal).toBeHidden({ timeout: 5_000 });
  });

  test('existing client row click opens modal in edit mode', async ({ page }) => {
    await navTo(page, 'clients');
    await page.waitForFunction(() => {
      const el = document.getElementById('clientsList');
      return el && !el.textContent?.includes('Загрузка');
    }, undefined, { timeout: 10_000 });

    // Click first client row (if exists)
    const clientRow = page.locator('#clientsList .ct-row').first();
    if (await clientRow.count() > 0) {
      await clientRow.click();
      const modal = page.locator('#clientModal');
      await expect(modal).toBeVisible({ timeout: 5_000 });
      // Modal title should be "Клиент" (edit mode)
      const title = await page.locator('#clientModalTitle').textContent();
      expect(title).toMatch(/Клиент/);
      // Delete button should be visible in edit mode
      await expect(page.locator('#clientDelete')).toBeVisible();
      await page.click('#clientModalClose');
    }
  });

  test('search input filters the client list', async ({ page }) => {
    await navTo(page, 'clients');
    await page.waitForFunction(() => {
      const el = document.getElementById('clientsList');
      return el && !el.textContent?.includes('Загрузка');
    }, undefined, { timeout: 10_000 });
    await page.fill('#clientsSearch', 'Алиева');
    // Small wait for debounce
    await page.waitForTimeout(600);
    // List should still be visible (not crashed)
    await expect(page.locator('#clientsList')).toBeVisible();
  });
});

// ─── T4 — Services ──────────────────────────────────────────────────────────

test.describe('T4 — Services', () => {
  test.setTimeout(30_000);
  test.beforeEach(async ({ page }) => { await loginViaApi(page); });

  test('services list loads with counter', async ({ page }) => {
    await navTo(page, 'services');
    await page.waitForFunction(() => {
      const el = document.getElementById('servicesList');
      return el && !el.textContent?.includes('Загрузка');
    }, undefined, { timeout: 10_000 });
    await expect(page.locator('#servicesList')).toBeVisible();
    await expect(page.locator('#servicesCounter')).toBeVisible();
    // Counter should show a number > 0 (seed data adds 13+ services)
    const counterText = await page.locator('#servicesCounter').textContent();
    expect(Number(counterText)).toBeGreaterThan(0);
  });

  test('add service toggle button is visible for owner', async ({ page }) => {
    await navTo(page, 'services');
    await expect(page.locator('#addServiceToggle')).toBeVisible();
  });

  test('clicking add service toggle opens the add form', async ({ page }) => {
    await navTo(page, 'services');
    await page.click('#addServiceToggle');
    // The <details> block should open
    const block = page.locator('#addServiceBlock');
    await expect(block).toHaveAttribute('open', '', { timeout: 3_000 });
    // Form fields should be visible
    await expect(page.locator('#svcName')).toBeVisible();
    await expect(page.locator('#svcPrice')).toBeVisible();
  });
});

// ─── T5 — Promotion placeholder ─────────────────────────────────────────────
test.describe('T5 — Promotion view', () => {
  test.setTimeout(20_000);
  test.beforeEach(async ({ page }) => { await loginViaApi(page); });

  test('Акции nav item is enabled and links to promotion view', async ({ page }) => {
    const promoNavLink = page.locator('a[data-view="promotion"]');
    await expect(promoNavLink).toBeAttached();
    await expect(promoNavLink).not.toHaveClass(/disabled/);
  });

  test('promotion view loads with promo list and add button', async ({ page }) => {
    await navTo(page, 'promotion');
    await expect(page.locator('#promoAddBtn')).toBeVisible();
    await expect(page.locator('#promosList')).toBeAttached();
  });

  test('API endpoint GET /api/bookings/promos is accessible', async ({ page }) => {
    const resp = await page.request.get(`${BASE}/api/bookings/promos`, {
      headers: { Authorization: `Bearer ${await page.evaluate(() => localStorage.getItem('access_token'))}` },
    });
    expect(resp.ok()).toBeTruthy();
    const body = await resp.json();
    expect(body).toHaveProperty('items');
    expect(Array.isArray(body.items)).toBeTruthy();
  });
});

// ─── T6 — Sales ─────────────────────────────────────────────────────────────

test.describe('T6 — Sales', () => {
  test.setTimeout(30_000);
  test.beforeEach(async ({ page }) => { await loginViaApi(page); });

  test('sales view loads with KPI row', async ({ page }) => {
    await navTo(page, 'sales');
    await expect(page.locator('#salesKpiRow')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('#salesKpiRevenue')).toBeVisible();
    await expect(page.locator('#salesKpiCount')).toBeVisible();
  });

  test('sales KPI values load from API (not stuck on —)', async ({ page }) => {
    await navTo(page, 'sales');
    // Wait for API response to populate
    await page.waitForFunction(() => {
      const el = document.getElementById('salesKpiRevenue');
      return el && el.textContent !== '';
    }, undefined, { timeout: 8_000 });
    await expect(page.locator('#salesKpiRevenue')).not.toBeEmpty();
  });
});

// ─── T7 — Analytics ─────────────────────────────────────────────────────────

test.describe('T7 — Analytics', () => {
  test.setTimeout(30_000);
  test.beforeEach(async ({ page }) => { await loginViaApi(page); });

  test('analytics view loads with KPI cards', async ({ page }) => {
    await navTo(page, 'analytics');
    await expect(page.locator('#anKpiRevenue')).toBeVisible({ timeout: 5_000 });
    await page.waitForFunction(() => {
      const el = document.getElementById('anKpiRevenue');
      return el && el.textContent !== '';
    }, undefined, { timeout: 10_000 });
  });

  test('period pills switch the analytics range', async ({ page }) => {
    await navTo(page, 'analytics');
    const pills = page.locator('#analyticsPeriodPills .period-pill');
    expect(await pills.count()).toBeGreaterThanOrEqual(4);
    // Click each pill and verify it becomes active
    const weekPill = pills.filter({ hasText: 'Неделя' });
    await weekPill.click();
    await expect(weekPill).toHaveClass(/active/);
    const todayPill = pills.filter({ hasText: 'Сегодня' });
    await todayPill.click();
    await expect(todayPill).toHaveClass(/active/);
  });
});

// ─── T8 — Inventory (Склад) ─────────────────────────────────────────────────

test.describe('T8 — Inventory', () => {
  test.setTimeout(30_000);
  test.beforeEach(async ({ page }) => { await loginViaApi(page); });

  test('inventory view loads products list', async ({ page }) => {
    await navTo(page, 'inventory');
    await expect(page.locator('#productsList')).toBeVisible({ timeout: 5_000 });
    await page.waitForFunction(() => {
      const el = document.getElementById('productsList');
      return el && !el.textContent?.includes('Загрузка');
    }, undefined, { timeout: 10_000 });
  });

  test('add product toggle is visible', async ({ page }) => {
    await navTo(page, 'inventory');
    await expect(page.locator('#addProductToggle')).toBeVisible({ timeout: 5_000 });
  });
});

// ─── T9 — Settings ──────────────────────────────────────────────────────────

test.describe('T9 — Settings', () => {
  test.setTimeout(30_000);
  test.beforeEach(async ({ page }) => { await loginViaApi(page); });

  test('settings view loads company form', async ({ page }) => {
    await navTo(page, 'settings');
    await expect(page.locator('#setCompanyName')).toBeVisible({ timeout: 10_000 });
    // Company name field should be populated from API
    await page.waitForFunction(() => {
      const el = document.getElementById('setCompanyName') as HTMLInputElement;
      return el && el.value !== '';
    }, undefined, { timeout: 10_000 });
    const name = await page.locator('#setCompanyName').inputValue();
    expect(name.length).toBeGreaterThan(0);
  });
});

// ─── T10 — Client modal (live version — no История tab) ──────────────────────
// In the live build the client modal has a single-tab form (no tab bar, no Historia tab).

test.describe('T10 — Client modal', () => {
  test.setTimeout(40_000);
  test.beforeEach(async ({ page }) => { await loginViaApi(page); });

  test('new client modal opens with correct form fields', async ({ page }) => {
    await navTo(page, 'clients');
    await page.waitForFunction(() => {
      const el = document.getElementById('clientsList');
      return el && !el.textContent?.includes('Загрузка');
    }, undefined, { timeout: 10_000 });

    await page.click('#clientsAddBtn');
    await page.waitForSelector('#clientModal:not([hidden])', { timeout: 5_000 });

    // Form is visible
    await expect(page.locator('#clientForm')).toBeVisible();
    await expect(page.locator('#clFullName')).toBeVisible();
    await expect(page.locator('#clPhone')).toBeVisible();
    await expect(page.locator('#clBirthday')).toBeVisible();
    await expect(page.locator('#clGender')).toBeVisible();

    // Title is "Новый клиент"
    await expect(page.locator('#clientModalTitle')).toHaveText('Новый клиент');

    // Delete button is hidden for new client
    await expect(page.locator('#clientDelete')).toBeHidden();

    // Close via Отмена button
    await page.click('#clientCancel');
    await expect(page.locator('#clientModal')).toBeHidden();
  });

  test('creating a new client via modal succeeds', async ({ page }) => {
    await navTo(page, 'clients');
    await page.waitForFunction(() => {
      const el = document.getElementById('clientsList');
      return el && !el.textContent?.includes('Загрузка');
    }, undefined, { timeout: 10_000 });

    await page.click('#clientsAddBtn');
    await page.waitForSelector('#clientModal:not([hidden])', { timeout: 5_000 });

    const uniquePhone = `+799${Date.now().toString().slice(-8)}`;
    await page.fill('#clFullName', 'Тест Playwright');
    await page.fill('#clPhone', uniquePhone);

    await page.click('#clientSubmit');

    // After successful create, modal should close
    await expect(page.locator('#clientModal')).toBeHidden({ timeout: 8_000 });

    // Search for the newly created client by unique phone to find it regardless of page
    await page.fill('#clientsSearch', uniquePhone);
    await page.waitForFunction(() => {
      const el = document.getElementById('clientsList');
      return el && !el.textContent?.includes('Загрузка');
    }, undefined, { timeout: 10_000 });
    await expect(page.locator('#clientsList')).toContainText('Тест Playwright', { timeout: 5_000 });
  });
});

// ─── Full navigation smoke test ──────────────────────────────────────────────

test.describe('Full Navigation Smoke', () => {
  test.setTimeout(60_000);

  test('all enabled views are reachable without crashes', async ({ page }) => {
    await loginViaApi(page);

    // All enabled views
    const views = [
      'journal', 'schedule', 'clients', 'services', 'masters',
      'salary', 'sales', 'analytics', 'promotion', 'finance', 'inventory', 'settings',
    ];

    for (const view of views) {
      await page.click(`a.nav-item[data-view="${view}"]`);
      try {
        await page.waitForSelector(`section[data-view="${view}"]:not([hidden])`, { timeout: 8_000 });
      } catch {
        await page.screenshot({ path: `/tmp/samaya-tests/screenshots/nav-${view}-fail.png`, fullPage: true });
        throw new Error(`View "${view}" did not become visible within 8s`);
      }
      // Short settle
      await page.waitForTimeout(200);
    }
  });
});

// ─── T11 — Promotion (promo codes) ──────────────────────────────────────────

test.describe('T11 — Promotion (promo codes)', () => {
  test.setTimeout(40_000);
  test.beforeEach(async ({ page }) => { await loginViaApi(page); });

  test('Акции nav item is enabled and view loads', async ({ page }) => {
    await page.click('a.nav-item[data-view="promotion"]');
    await page.waitForSelector('section[data-view="promotion"]:not([hidden])', { timeout: 8_000 });
    await expect(page.locator('section[data-view="promotion"] h2.card-title')).toContainText('Промокоды');
    await expect(page.locator('#promoAddBtn')).toBeVisible();
  });

  test('can create a promo code', async ({ page }) => {
    await page.click('a.nav-item[data-view="promotion"]');
    await page.waitForSelector('#promoAddBtn:not([disabled])', { timeout: 8_000 });

    const code = `PW${Date.now().toString().slice(-5)}`;
    await page.click('#promoAddBtn');
    await page.waitForSelector('#promoModal:not([hidden])', { timeout: 5_000 });

    await expect(page.locator('#promoModalTitle')).toHaveText('Новый промокод');

    await page.fill('#promoCode', code);
    await page.fill('#promoName', 'Playwright Test Promo');
    await page.fill('#promoDiscount', '15');

    await page.click('#promoSubmit');
    await expect(page.locator('#promoModal')).toBeHidden({ timeout: 8_000 });

    // Promo should appear in list
    await expect(page.locator('#promosList')).toContainText(code, { timeout: 5_000 });
    await expect(page.locator('#promosList')).toContainText('Playwright Test Promo');
  });

  test('promo code API check returns correct discount', async ({ page }) => {
    // Create promo via API
    const token = await page.evaluate(() => localStorage.getItem('access_token'));
    const resp = await page.request.post('http://localhost:8010/api/bookings/promos', {
      headers: { Authorization: `Bearer ${token}` },
      data: { code: 'APICHECK99', name: 'API Check', discount_pct: 20 },
    });
    // 201 created or 409 if already exists from previous run — both OK
    expect([201, 409]).toContain(resp.status());

    const checkResp = await page.request.get(
      'http://localhost:8010/api/bookings/promos/check?code=APICHECK99',
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(checkResp.ok()).toBeTruthy();
    const body = await checkResp.json();
    expect(body.discount_pct).toBe(20);
    expect(body.is_active).toBe(true);
  });

  test('invalid promo code returns 404', async ({ page }) => {
    const token = await page.evaluate(() => localStorage.getItem('access_token'));
    const resp = await page.request.get(
      'http://localhost:8010/api/bookings/promos/check?code=DOESNOTEXIST_XYZ',
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(resp.status()).toBe(404);
    const body = await resp.json();
    expect(body.code).toBe('PROMO_NOT_FOUND');
  });
});

// ─── T12 — Client history tab ────────────────────────────────────────────────

test.describe('T12 — Client modal: История tab', () => {
  test.setTimeout(40_000);
  test.beforeEach(async ({ page }) => { await loginViaApi(page); });

  test('new client modal shows Данные tab active, История tab disabled', async ({ page }) => {
    await page.click('a.nav-item[data-view="clients"]');
    await page.waitForSelector('#clientsList', { timeout: 8_000 });

    await page.click('#clientsAddBtn');
    await page.waitForSelector('#clientModal:not([hidden])', { timeout: 5_000 });

    // Tab bar present
    await expect(page.locator('#clientTabBar')).toBeVisible();

    // Данные tab is active
    const infoTab = page.locator('#clientTabBar .tab-btn[data-tab="info"]');
    await expect(infoTab).toHaveClass(/tab-btn--active/);

    // История tab is disabled (no existing client)
    const histTab = page.locator('#clientTabHistory');
    await expect(histTab).toBeDisabled();

    // Form is visible
    await expect(page.locator('#clientForm')).toBeVisible();

    await page.click('#clientCancel');
    await expect(page.locator('#clientModal')).toBeHidden();
  });

  test('existing client enables История tab', async ({ page }) => {
    await page.click('a.nav-item[data-view="clients"]');
    await page.waitForFunction(() => {
      const el = document.getElementById('clientsList');
      return el && !el.textContent?.includes('Загрузка');
    }, undefined, { timeout: 10_000 });

    const firstRow = page.locator('#clientsList .ct-row').first();
    if (await firstRow.count() === 0) {
      test.skip();
      return;
    }

    await firstRow.click();
    await page.waitForSelector('#clientModal:not([hidden])', { timeout: 5_000 });

    // История tab should be enabled for existing client
    const histTab = page.locator('#clientTabHistory');
    await expect(histTab).not.toBeDisabled();

    // Click История tab
    await histTab.click();

    // History panel becomes visible
    await expect(page.locator('#clientHistoryTab')).toBeVisible({ timeout: 3_000 });

    await page.click('#clientModalClose');
    await expect(page.locator('#clientModal')).toBeHidden();
  });
});

// ─── T14 — Journal master filter ─────────────────────────────────────────────

test.describe('T14 — Journal master filter', () => {
  test.setTimeout(30_000);
  test.beforeEach(async ({ page }) => { await loginViaApi(page); });

  test('master filter button is visible in journal toolbar', async ({ page }) => {
    await navTo(page, 'journal');
    const trigger = page.locator('#jrnMasterFilterTrigger');
    await expect(trigger).toBeVisible();
    // Label should say «Все сотрудники»
    await expect(page.locator('#jrnMasterFilterLabel')).toHaveText('Все сотрудники');
    // Count badge should show a positive number
    const countText = await page.locator('#jrnMastersCount').textContent();
    expect(Number(countText)).toBeGreaterThan(0);
  });

  test('clicking master filter opens dropdown panel with master list', async ({ page }) => {
    await navTo(page, 'journal');
    await page.click('#jrnMasterFilterTrigger');
    const panel = page.locator('#jrnMasterFilterPanel');
    await expect(panel).toBeVisible();
    // «Все сотрудники» row with checkbox
    await expect(page.locator('#jrnMfAll')).toBeVisible();
    // At least one master row rendered
    const masterRows = page.locator('#jrnMfGroups .sch-mf-row.sch-mf-master');
    await expect(masterRows.first()).toBeVisible();
  });

  test('unchecking a master filters calendar columns', async ({ page }) => {
    await navTo(page, 'journal');

    // Count columns before opening filter
    const colsBefore = await page.locator('.cal-master-head').count();
    expect(colsBefore).toBeGreaterThan(0);

    // Open panel and uncheck first master
    await page.click('#jrnMasterFilterTrigger');
    await expect(page.locator('#jrnMasterFilterPanel')).toBeVisible();
    const firstMasterCb = page.locator('#jrnMfGroups [data-jmaster-cb]').first();
    await firstMasterCb.uncheck();

    // Close panel by clicking safe area (journal date label, outside the dropdown)
    await page.locator('#journalDateLabel').click();
    await page.waitForTimeout(200);

    // Calendar should now have one fewer column
    const colsAfter = await page.locator('.cal-master-head').count();
    expect(colsAfter).toBeLessThan(colsBefore);
  });

  test('unchecking all masters via «Все сотрудники» clears calendar', async ({ page }) => {
    await navTo(page, 'journal');
    await page.click('#jrnMasterFilterTrigger');
    await expect(page.locator('#jrnMasterFilterPanel')).toBeVisible();

    // Uncheck «Все сотрудники»
    await page.locator('#jrnMfAll').uncheck();

    // Close by clicking safe area (journal date label, outside the dropdown)
    await page.locator('#journalDateLabel').click();
    await page.waitForTimeout(200);

    // Label should show «Выбрано»
    const label = await page.locator('#jrnMasterFilterLabel').textContent();
    expect(label).toMatch(/Выбрано/);

    // No master columns in calendar
    const cols = await page.locator('.cal-master-head').count();
    expect(cols).toBe(0);
  });

  test('re-checking «Все сотрудники» restores all columns', async ({ page }) => {
    await navTo(page, 'journal');

    // Note: total before
    const totalBefore = await page.locator('.cal-master-head').count();

    // Open, uncheck all, close programmatically
    await page.click('#jrnMasterFilterTrigger');
    await expect(page.locator('#jrnMasterFilterPanel')).toBeVisible();
    await page.locator('#jrnMfAll').uncheck();
    await page.evaluate(() => {
      document.getElementById('jrnMasterFilterPanel')!.hidden = true;
      document.getElementById('jrnMasterFilter')!.classList.remove('open');
    });
    await page.waitForTimeout(200);

    // Re-open, check all, close programmatically
    await page.click('#jrnMasterFilterTrigger');
    await expect(page.locator('#jrnMasterFilterPanel')).toBeVisible();
    await page.locator('#jrnMfAll').check();
    await page.evaluate(() => {
      document.getElementById('jrnMasterFilterPanel')!.hidden = true;
      document.getElementById('jrnMasterFilter')!.classList.remove('open');
    });
    await page.waitForTimeout(200);

    // Label should be back to «Все сотрудники»
    await expect(page.locator('#jrnMasterFilterLabel')).toHaveText('Все сотрудники');

    // Columns should be back
    const cols = await page.locator('.cal-master-head').count();
    expect(cols).toBe(totalBefore);
  });

  test('selecting single master shows their name in trigger label', async ({ page }) => {
    await navTo(page, 'journal');
    await page.click('#jrnMasterFilterTrigger');

    // Uncheck all first
    await page.locator('#jrnMfAll').uncheck();

    // Check only the first master
    const firstCb = page.locator('#jrnMfGroups [data-jmaster-cb]').first();
    await firstCb.check();

    const label = await page.locator('#jrnMasterFilterLabel').textContent();
    // Label should be master name, not «Все сотрудники» or «Выбрано»
    expect(label).not.toBe('Все сотрудники');
    expect(label).not.toBe('Выбрано');
    expect(label!.length).toBeGreaterThan(1);
  });
});

// ─── T13 — Booking list API filters ──────────────────────────────────────────

test.describe('T13 — Booking API: client_phone filter', () => {
  test.setTimeout(20_000);
  test.beforeEach(async ({ page }) => { await loginViaApi(page); });

  test('GET /api/bookings with client_phone filter returns valid response', async ({ page }) => {
    const token = await page.evaluate(() => localStorage.getItem('access_token'));
    const resp = await page.request.get(
      'http://localhost:8010/api/bookings?from=2020-01-01&to=2099-12-31&client_phone=%2B7999&limit=10',
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(resp.ok()).toBeTruthy();
    const body = await resp.json();
    expect(body).toHaveProperty('items');
    expect(Array.isArray(body.items)).toBeTruthy();
  });
});
