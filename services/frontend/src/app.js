import {
  VIEW_TITLES, CLIENT_SEGMENTS, MOVEMENT_LABEL, WEEKDAYS_SHORT, STATUS_LABEL,
  MONTHS_RU, MONTHS_RU_GENITIVE, MONTHS_RU_SHORT, WEEKDAYS_RU, WEEKDAYS_FULL,
  MONTH_NOM, STATUS_COLOR, SOURCE_LABEL,
} from './modules/constants.js';
import {
  escapeHtml, formatPrice, fmtMoney, todayLocalISO, dateToISO, addDaysISO,
} from './modules/utils.js';
import { toast } from './modules/toast.js';
import { trapFocus } from './modules/focus-trap.js';

(() => {
  'use strict';

  const els = {
    // sidebar
    navItems: document.querySelectorAll('.nav-item'),
    userMini: document.getElementById('userMini'),
    userMiniAvatar: document.getElementById('userMiniAvatar'),
    userMiniName: document.getElementById('userMiniName'),
    userMiniRole: document.getElementById('userMiniRole'),
    dotBackend: document.getElementById('dotBackend'),
    statusLabel: document.getElementById('statusLabel'),

    // topbar
    viewTitle: document.getElementById('viewTitle'),
    apilogToggle: document.getElementById('apilogToggle'),
    topbarUser: document.getElementById('topbarUser'),
    topbarUserAvatar: document.getElementById('topbarUserAvatar'),
    topbarUserName: document.getElementById('topbarUserName'),
    topbarSalon: document.getElementById('topbarSalon'),

    // journal extras (DIKIDI-style)
    journalDateLabel: document.getElementById('journalDateLabel'),
    journalDateBtn: document.getElementById('journalDateBtn'),
    journalPrevDay: document.getElementById('journalPrevDay'),
    journalNextDay: document.getElementById('journalNextDay'),
    journalPeriodBtns: document.querySelectorAll('.journal-period-btn'),
    journalFiltersPanel: document.getElementById('journalFiltersPanel'),
    journalCharts: document.getElementById('journalCharts'),
    filterMaster: document.getElementById('filterMaster'),
    filterStatus: document.getElementById('filterStatus'),
    filterSource: document.getElementById('filterSource'),
    filterClient: document.getElementById('filterClient'),
    filterAnon: document.getElementById('filterAnon'),
    filterReset: document.getElementById('filterReset'),
    legendMasters: document.getElementById('legendMasters'),
    legendServices: document.getElementById('legendServices'),
    legendSources: document.getElementById('legendSources'),
    miniCal: document.getElementById('miniCal'),
    financeTotal: document.getElementById('financeTotal'),
    financeCash: document.getElementById('financeCash'),
    financeCard: document.getElementById('financeCard'),
    financeDonutCash: document.getElementById('financeDonutCash'),
    financeRefresh: document.getElementById('financeRefresh'),
    addSaleBtn: document.getElementById('addSaleBtn'),

    // schedule extras (DIKIDI-style)
    schPrevMonth: document.getElementById('schPrevMonth'),
    schNextMonth: document.getElementById('schNextMonth'),
    schPrevMonthLabel: document.getElementById('schPrevMonthLabel'),
    schNextMonthLabel: document.getElementById('schNextMonthLabel'),
    schMonthLabel: document.getElementById('schMonthLabel'),
    schMastersCount: document.getElementById('schMastersCount'),
    schAddMaster: document.getElementById('schAddMaster'),

    // views
    views: document.querySelectorAll('.view'),

    // auth
    authGuest: document.getElementById('authGuest'),
    authUser: document.getElementById('authUser'),
    authError: document.getElementById('authError'),
    userError: document.getElementById('userError'),
    loginForm: document.getElementById('loginForm'),
    registerForm: document.getElementById('registerForm'),
    refreshBtn: document.getElementById('refreshBtn'),
    logoutBtn: document.getElementById('logoutBtn'),
    userName: document.getElementById('userName'),
    userMeta: document.getElementById('userMeta'),
    userAvatar: document.getElementById('userAvatar'),
    claimSub: document.getElementById('claimSub'),
    claimCompany: document.getElementById('claimCompany'),
    claimRole: document.getElementById('claimRole'),
    claimExp: document.getElementById('claimExp'),
    tabs: document.querySelectorAll('.tab'),
    panes: document.querySelectorAll('.tab-pane'),

    // services / masters
    servicesList: document.getElementById('servicesList'),
    servicesCounter: document.getElementById('servicesCounter'),
    addServiceForm: document.getElementById('addServiceForm'),
    addServiceBlock: document.getElementById('addServiceBlock'),
    addServiceToggle: document.getElementById('addServiceToggle'),
    addServiceCancel: document.getElementById('addServiceCancel'),

    mastersList: document.getElementById('mastersList'),
    mastersCounter: document.getElementById('mastersCounter'),
    addMasterForm: document.getElementById('addMasterForm'),
    addMasterBlock: document.getElementById('addMasterBlock'),
    addMasterToggle: document.getElementById('addMasterToggle'),
    addMasterCancel: document.getElementById('addMasterCancel'),

    // journal
    journalList: document.getElementById('journalList'),
    journalCalendar: document.getElementById('journalCalendar'),
    journalCounter: document.getElementById('journalCounter'),
    journalDate: document.getElementById('journalDate'),
    calToggleBtns: document.querySelectorAll('.cal-toggle-btn'),
    addBookingForm: document.getElementById('addBookingForm'),
    addBookingBlock: document.getElementById('addBookingBlock'),
    addBookingBackdrop: document.getElementById('addBookingBackdrop'),
    addBookingClose: document.getElementById('addBookingClose'),
    addBookingToggle: document.getElementById('addBookingToggle'),
    addBookingCancel: document.getElementById('addBookingCancel'),
    bMaster: document.getElementById('bMaster'),
    bManager: document.getElementById('bManager'),
    bDate: document.getElementById('bDate'),
    bTime: document.getElementById('bTime'),
    bClientSearch: document.getElementById('bClientSearch'),
    bClientSuggest: document.getElementById('bClientSuggest'),
    bClientNew: document.getElementById('bClientNew'),

    // schedule
    schMaster: document.getElementById('schMaster'),
    schFrom: document.getElementById('schFrom'),
    schTo: document.getElementById('schTo'),
    schGrid: document.getElementById('schGrid'),
    schSave: document.getElementById('schSave'),
    schApplyTemplate: document.getElementById('schApplyTemplate'),

    // inventory
    productsList: document.getElementById('productsList'),
    productsCounter: document.getElementById('productsCounter'),
    addProductForm: document.getElementById('addProductForm'),
    addProductBlock: document.getElementById('addProductBlock'),
    addProductToggle: document.getElementById('addProductToggle'),
    addProductCancel: document.getElementById('addProductCancel'),
    addReceiptForm: document.getElementById('addReceiptForm'),
    addReceiptBlock: document.getElementById('addReceiptBlock'),
    addReceiptToggle: document.getElementById('addReceiptToggle'),
    addReceiptCancel: document.getElementById('addReceiptCancel'),
    addReceiptItem: document.getElementById('addReceiptItem'),
    receiptItems: document.getElementById('receiptItems'),
    rSupplier: document.getElementById('rSupplier'),
    rSupplierAddToggle: document.getElementById('rSupplierAddToggle'),
    rSupplierAddInline: document.getElementById('rSupplierAddInline'),
    rSupplierNewName: document.getElementById('rSupplierNewName'),
    rSupplierAddSave: document.getElementById('rSupplierAddSave'),
    rSupplierAddCancel: document.getElementById('rSupplierAddCancel'),
    techCardsList: document.getElementById('techCardsList'),
    techCardsCounter: document.getElementById('techCardsCounter'),
    editTechCardForm: document.getElementById('editTechCardForm'),
    editTechCardBlock: document.getElementById('editTechCardBlock'),
    editTechCardToggle: document.getElementById('editTechCardToggle'),
    editTechCardCancel: document.getElementById('editTechCardCancel'),
    addTechCardItem: document.getElementById('addTechCardItem'),
    techCardItems: document.getElementById('techCardItems'),
    tcService: document.getElementById('tcService'),
    movementsList: document.getElementById('movementsList'),
    movementsCounter: document.getElementById('movementsCounter'),

    // clients
    clientsSubnav: document.getElementById('clientsSubnav'),
    clientsSearch: document.getElementById('clientsSearch'),
    clientsAddBtn: document.getElementById('clientsAddBtn'),
    clientsList: document.getElementById('clientsList'),
    clientsPagination: document.getElementById('clientsPagination'),
    clientsSegments: document.getElementById('clientsSegments'),
    clientsMoreBtn: document.getElementById('clientsMoreBtn'),
    clientsMoreMenu: document.getElementById('clientsMoreMenu'),
    clientsExportCsv: document.getElementById('clientsExportCsv'),
    clientModal: document.getElementById('clientModal'),
    clientModalBackdrop: document.getElementById('clientModalBackdrop'),
    clientModalClose: document.getElementById('clientModalClose'),
    clientModalTitle: document.getElementById('clientModalTitle'),
    clientForm: document.getElementById('clientForm'),
    clientId: document.getElementById('clientId'),
    clFullName: document.getElementById('clFullName'),
    clPhone: document.getElementById('clPhone'),
    clBirthday: document.getElementById('clBirthday'),
    clGender: document.getElementById('clGender'),
    clEmail: document.getElementById('clEmail'),
    clComment: document.getElementById('clComment'),
    clientCancel: document.getElementById('clientCancel'),
    clientDelete: document.getElementById('clientDelete'),
    clientFormError: document.getElementById('clientFormError'),
    clientTabBar: document.getElementById('clientTabBar'),
    clientTabHistory: document.getElementById('clientTabHistory'),
    clientHistoryTab: document.getElementById('clientHistoryTab'),
    clientHistoryList: document.getElementById('clientHistoryList'),
    clientTabAnalyzes: document.getElementById('clientTabAnalyzes'),
    clientAnalyzesTab: document.getElementById('clientAnalyzesTab'),
    clFilesList: document.getElementById('clFilesList'),
    clFileUpload: document.getElementById('clFileUpload'),
    clCopyUploadLink: document.getElementById('clCopyUploadLink'),

    // promotion view
    promoAddBtn: document.getElementById('promoAddBtn'),
    promosList: document.getElementById('promosList'),
    promosCounter: document.getElementById('promosCounter'),
    promoModal: document.getElementById('promoModal'),
    promoModalBackdrop: document.getElementById('promoModalBackdrop'),
    promoModalClose: document.getElementById('promoModalClose'),
    promoModalTitle: document.getElementById('promoModalTitle'),
    promoForm: document.getElementById('promoForm'),
    promoId: document.getElementById('promoId'),
    promoCode: document.getElementById('promoCode'),
    promoName: document.getElementById('promoName'),
    promoDiscount: document.getElementById('promoDiscount'),
    promoFrom: document.getElementById('promoFrom'),
    promoTo: document.getElementById('promoTo'),
    promoMaxUses: document.getElementById('promoMaxUses'),
    promoSubmit: document.getElementById('promoSubmit'),
    promoDelete: document.getElementById('promoDelete'),
    promoCancel: document.getElementById('promoCancel'),
    promoFormError: document.getElementById('promoFormError'),
    salePromoCode: document.getElementById('salePromoCode'),
    salePromoApply: document.getElementById('salePromoApply'),
    salePromoMsg: document.getElementById('salePromoMsg'),
    saleBonusSection: document.getElementById('saleBonusSection'),
    saleBonusBalance: document.getElementById('saleBonusBalance'),
    saleBonusSpend: document.getElementById('saleBonusSpend'),
    saleBonusHint: document.getElementById('saleBonusHint'),
    // client modal bonus section
    clBonusSection: document.getElementById('clBonusSection'),
    clBonusDisplay: document.getElementById('clBonusDisplay'),
    clBonusAdjBtn: document.getElementById('clBonusAdjBtn'),
    clBonusAdjForm: document.getElementById('clBonusAdjForm'),
    clBonusAdjAmount: document.getElementById('clBonusAdjAmount'),
    clBonusAdjNote: document.getElementById('clBonusAdjNote'),
    clBonusAdjSave: document.getElementById('clBonusAdjSave'),
    clBonusAdjCancel: document.getElementById('clBonusAdjCancel'),
    clBalanceSection: document.getElementById('clBalanceSection'),
    clBalanceDisplay: document.getElementById('clBalanceDisplay'),
    clBalanceTopupBtn: document.getElementById('clBalanceTopupBtn'),
    clBalanceTopupForm: document.getElementById('clBalanceTopupForm'),
    clBalanceAmount: document.getElementById('clBalanceAmount'),
    clBalanceAccount: document.getElementById('clBalanceAccount'),
    clBalanceNote: document.getElementById('clBalanceNote'),
    clBalanceSave: document.getElementById('clBalanceSave'),
    clBalanceCancel: document.getElementById('clBalanceCancel'),
    clBalanceOps: document.getElementById('clBalanceOps'),
    // bonus program tab
    clientsTabBonus: document.getElementById('clientsTabBonus'),
    bonusSettingsSave: document.getElementById('bonusSettingsSave'),
    bonusAccrualRate: document.getElementById('bonusAccrualRate'),
    bonusMaxSpend: document.getElementById('bonusMaxSpend'),
    bonusSettingsSaved: document.getElementById('bonusSettingsSaved'),
    bonusTopList: document.getElementById('bonusTopList'),
    bonusTopCounter: document.getElementById('bonusTopCounter'),

    // api log
    apiLog: document.getElementById('apiLog'),
    apilogDrawer: document.getElementById('apilogDrawer'),
    apilogClose: document.getElementById('apilogClose'),

    // booking view modal
    bkModalBackdrop: document.getElementById('bkModalBackdrop'),
    bkModal: document.getElementById('bkModal'),
    bkModalTitle: document.getElementById('bkModalTitle'),
    bkModalDot: document.getElementById('bkModalDot'),
    bkModalBody: document.getElementById('bkModalBody'),
    bkModalFoot: document.getElementById('bkModalFoot'),
    bkModalClose: document.getElementById('bkModalClose'),
    bkModalClose2: document.getElementById('bkModalClose2'),
    bkModalRepeat: document.getElementById('bkModalRepeat'),

    // finance section
    financeSubnav: document.getElementById('financeSubnav'),
    finTabOverview: document.getElementById('finTabOverview'),
    finTabAccounts: document.getElementById('finTabAccounts'),
    finTabOps: document.getElementById('finTabOps'),
    finKpiIncome: document.getElementById('finKpiIncome'),
    finKpiExpense: document.getElementById('finKpiExpense'),
    finKpiProfit: document.getElementById('finKpiProfit'),
    finTransCounter: document.getElementById('finTransCounter'),
    finTransList: document.getElementById('finTransList'),
    finAccountsCounter: document.getElementById('finAccountsCounter'),
    finAccountsList: document.getElementById('finAccountsList'),
    finOpsCounter: document.getElementById('finOpsCounter'),
    finOpsList: document.getElementById('finOpsList'),
    finAddIncomeBtn: document.getElementById('finAddIncomeBtn'),
    finAddExpenseBtn: document.getElementById('finAddExpenseBtn'),
    finTransferBtn: document.getElementById('finTransferBtn'),
    finAddAccountBtn: document.getElementById('finAddAccountBtn'),
    // finance modals
    finIncomeBackdrop: document.getElementById('finIncomeBackdrop'),
    finIncomeModal: document.getElementById('finIncomeModal'),
    finIncomeForm: document.getElementById('finIncomeForm'),
    finIncomeClose: document.getElementById('finIncomeClose'),
    finIncomeCancel: document.getElementById('finIncomeCancel'),
    finIncomeDate: document.getElementById('finIncomeDate'),
    finIncomeAmount: document.getElementById('finIncomeAmount'),
    finIncomeAccount: document.getElementById('finIncomeAccount'),
    finIncomeCategory: document.getElementById('finIncomeCategory'),
    finIncomeNote: document.getElementById('finIncomeNote'),
    finExpenseBackdrop: document.getElementById('finExpenseBackdrop'),
    finExpenseModal: document.getElementById('finExpenseModal'),
    finExpenseForm: document.getElementById('finExpenseForm'),
    finExpenseClose: document.getElementById('finExpenseClose'),
    finExpenseCancel: document.getElementById('finExpenseCancel'),
    finExpenseDate: document.getElementById('finExpenseDate'),
    finExpenseAmount: document.getElementById('finExpenseAmount'),
    finExpenseAccount: document.getElementById('finExpenseAccount'),
    finExpenseCategory: document.getElementById('finExpenseCategory'),
    finExpenseNote: document.getElementById('finExpenseNote'),
    finTransferBackdrop: document.getElementById('finTransferBackdrop'),
    finTransferModal: document.getElementById('finTransferModal'),
    finTransferForm: document.getElementById('finTransferForm'),
    finTransferClose: document.getElementById('finTransferClose'),
    finTransferCancel: document.getElementById('finTransferCancel'),
    finTransferDate: document.getElementById('finTransferDate'),
    finTransferAmount: document.getElementById('finTransferAmount'),
    finTransferFrom: document.getElementById('finTransferFrom'),
    finTransferTo: document.getElementById('finTransferTo'),
    finTransferNote: document.getElementById('finTransferNote'),
    finAccountBackdrop: document.getElementById('finAccountBackdrop'),
    finAccountModal: document.getElementById('finAccountModal'),
    finAccountForm: document.getElementById('finAccountForm'),
    finAccountClose: document.getElementById('finAccountClose'),
    finAccountCancel: document.getElementById('finAccountCancel'),
    finAccountName: document.getElementById('finAccountName'),
    finAccountInitBal: document.getElementById('finAccountInitBal'),
    // income/expense counterparty selects
    finIncomeCparty: document.getElementById('finIncomeCparty'),
    finExpenseCparty: document.getElementById('finExpenseCparty'),
    // categories tab
    finTabCategories: document.getElementById('finTabCategories'),
    finCatIncomeList: document.getElementById('finCatIncomeList'),
    finCatExpenseList: document.getElementById('finCatExpenseList'),
    finCatAddIncomeBtn: document.getElementById('finCatAddIncomeBtn'),
    finCatAddExpenseBtn: document.getElementById('finCatAddExpenseBtn'),
    finCatIncomeForm: document.getElementById('finCatIncomeForm'),
    finCatExpenseForm: document.getElementById('finCatExpenseForm'),
    finCatIncomeName: document.getElementById('finCatIncomeName'),
    finCatExpenseName: document.getElementById('finCatExpenseName'),
    finCatIncomeCancel: document.getElementById('finCatIncomeCancel'),
    finCatExpenseCancel: document.getElementById('finCatExpenseCancel'),
    // counterparties tab
    finTabCounterparties: document.getElementById('finTabCounterparties'),
    finCpartyCounter: document.getElementById('finCpartyCounter'),
    finCpartyList: document.getElementById('finCpartyList'),
    finCpartyAddBtn: document.getElementById('finCpartyAddBtn'),
    finCpartyBackdrop: document.getElementById('finCpartyBackdrop'),
    finCpartyModal: document.getElementById('finCpartyModal'),
    finCpartyForm: document.getElementById('finCpartyForm'),
    finCpartyClose: document.getElementById('finCpartyClose'),
    finCpartyCancel: document.getElementById('finCpartyCancel'),
    finCpartyId: document.getElementById('finCpartyId'),
    finCpartyName: document.getElementById('finCpartyName'),
    finCpartyKind: document.getElementById('finCpartyKind'),
    finCpartyInn: document.getElementById('finCpartyInn'),
    finCpartyPhone: document.getElementById('finCpartyPhone'),
    finCpartyEmail: document.getElementById('finCpartyEmail'),
    finCpartyNotes: document.getElementById('finCpartyNotes'),
  };

  const CAL_START_HOUR = 9;
  const CAL_END_HOUR = 22;
  const CAL_PX_PER_MIN = 1; // 60px = 1 час
  const CAL_TIME_AXIS_W = 56;
  const CAL_HEAD_H = 64;
  const CAL_HOUR_H = 60;

  let miniCalAnchor = null; // YYYY-MM, какой месяц показан в мини-календаре
  let scheduleMonth = null; // YYYY-MM, текущий месяц расписания

  let cachedServices = [];
  let cachedServiceCategories = [];
  let svcEditMasters = [];
  let svcEditMaterialsOrig = '';
  let cachedMasters = [];
  let mastersLoadedAt = 0;
  let cachedBookings = [];
  let cachedTimeBlocks = [];
  let cachedProducts = [];
  let cachedSuppliers = [];
  let cachedTechCards = [];
  let journalMode = localStorage.getItem('journalMode') || 'calendar'; // calendar | list
  let journalPeriod = localStorage.getItem('journalPeriod') || 'day';   // day | week | month
  const journalFilters = { master_id: '', status: '', source: '', client: '', anon: false };
  let jrnSelectedMasters = null; // Set<id> — null означает «все»; управляется jrnRenderMasterFilter
  let scheduleItems = []; // [{ work_date, start_time, end_time, is_day_off, saved, dirty }]
  let currentView = 'profile';
  let financeTab = 'overview';

  // Возвращает {from, to} для текущего периода и якорной даты journalDate.
  // day → один день; week → пн-вс той недели; month → 1-е и последнее число того месяца.
  function getJournalRange() {
    const anchor = els.journalDate.value || todayLocalISO();
    if (journalPeriod === 'day') return { from: anchor, to: anchor };
    const [y, m, d] = anchor.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    if (journalPeriod === 'week') {
      const dow = dt.getDay(); // 0=Sun..6=Sat → к понедельнику
      const offset = dow === 0 ? -6 : 1 - dow;
      const from = new Date(dt); from.setDate(dt.getDate() + offset);
      const to = new Date(from); to.setDate(from.getDate() + 6);
      return { from: dateToISO(from), to: dateToISO(to) };
    }
    if (journalPeriod === 'month') {
      const from = new Date(y, m - 1, 1);
      const to = new Date(y, m, 0);
      return { from: dateToISO(from), to: dateToISO(to) };
    }
    return { from: anchor, to: anchor };
  }

  function formatRangeLabel({ from, to }) {
    const [fy, fm, fd] = from.split('-').map(Number);
    const fdt = new Date(fy, fm - 1, fd);
    if (journalPeriod === 'day') {
      return `${WEEKDAYS_RU[fdt.getDay()]}, ${fd} ${MONTHS_RU_GENITIVE[fm - 1]}`;
    }
    if (journalPeriod === 'month') {
      return `${MONTH_NOM[fm - 1]} ${fy}`;
    }
    const [, tm, td] = to.split('-').map(Number);
    if (fm === tm) return `${fd}–${td} ${MONTHS_RU_GENITIVE[fm - 1]}`;
    return `${fd} ${MONTHS_RU_GENITIVE[fm - 1]} – ${td} ${MONTHS_RU_GENITIVE[tm - 1]}`;
  }

  function formatTimeRange(startsIso, endsIso) {
    const s = new Date(startsIso);
    const e = new Date(endsIso);
    const fmt = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    return `${fmt(s)} – ${fmt(e)}`;
  }

  const store = {
    get access() { return localStorage.getItem('access_token'); },
    set access(v) { v ? localStorage.setItem('access_token', v) : localStorage.removeItem('access_token'); },
    get refresh() { return localStorage.getItem('refresh_token'); },
    set refresh(v) { v ? localStorage.setItem('refresh_token', v) : localStorage.removeItem('refresh_token'); },
    get user() {
      const raw = localStorage.getItem('user');
      try { return raw ? JSON.parse(raw) : null; } catch { return null; }
    },
    set user(v) { v ? localStorage.setItem('user', JSON.stringify(v)) : localStorage.removeItem('user'); },
    clear() { this.access = null; this.refresh = null; this.user = null; },
  };

  function logCall(method, path, status) {
    const ts = new Date().toLocaleTimeString();
    const line = `[${ts}] ${method.padEnd(4)} ${path} → ${status}`;
    const cur = els.apiLog.textContent;
    els.apiLog.textContent = (cur === 'Ожидание запросов…' ? '' : cur + '\n') + line;
    els.apiLog.scrollTop = els.apiLog.scrollHeight;
  }

  async function call(method, path, body, token) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    let res;
    try {
      res = await fetch(path, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      logCall(method, path, 'NETWORK_ERROR');
      return { ok: false, status: 0, data: { error: 'network error' } };
    }
    let data = null;
    try { data = await res.json(); } catch { /* no body */ }
    logCall(method, path, res.status);
    return { ok: res.ok, status: res.status, data };
  }

  function decodeJwt(token) {
    try {
      const [, payload] = token.split('.');
      const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
      return JSON.parse(decodeURIComponent(escape(json)));
    } catch { return null; }
  }

  function stringToColor(s) {
    let h = 0;
    for (let i = 0; i < (s || '').length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return `hsl(${h % 360} 60% 55%)`;
  }

  // ===== View switching =====
  function setView(view) {
    if (!VIEW_TITLES[view]) view = 'profile';
    currentView = view;
    els.views.forEach((v) => {
      const match = v.dataset.view === view;
      v.classList.toggle('active', match);
      v.hidden = !match;
    });
    els.navItems.forEach((n) => {
      n.classList.toggle('active', n.dataset.view === view);
    });
    els.viewTitle.textContent = VIEW_TITLES[view];
    if (view === 'services') void Promise.all([loadServices(), salLoadCommissions()]);
    if (view === 'masters') void loadMasters();
    if (view === 'journal') {
      if (!els.journalDate.value) els.journalDate.value = todayLocalISO();
      if (!miniCalAnchor) miniCalAnchor = els.journalDate.value.slice(0, 7);
      // нарисовать шелл сразу — мастеров/записей может не быть, но дата/мини-календарь/финансы должны быть видны
      renderJournal();
      // если мастеров нет — подгрузить (тогда шелл уже виден)
      void loadMasters().then(renderJournal);
      void loadBookings();
      populateBookingForm();
    }
    if (view === 'schedule') {
      void initScheduleView();
    }
    if (view === 'inventory') {
      void loadInventoryAll();
    }
    if (view === 'clients') {
      switchClientsTab(clientsActiveTab);
      void loadClientsAll();
    }
    if (view === 'finance') {
      renderFinanceView();
    }
    if (view === 'salary') {
      void activateSalaryView();
    }
    if (view === 'settings') {
      void activateSettingsView();
    }
    if (view === 'sales') {
      void activateSalesView();
    }
    if (view === 'promotion') {
      void activatePromotionView();
    }
    if (view === 'analytics') {
      void loadMasters().then(() => activateAnalyticsView());
      return;
    }
    if (view === 'today') {
      void loadTodayDashboard();
      return;
    }
  }

  // Sidebar nav clicks
  els.navItems.forEach((n) => {
    n.addEventListener('click', (e) => {
      e.preventDefault();
      if (n.classList.contains('disabled')) return;
      const v = n.dataset.view;
      if (v) setView(v);
      // мобильно: после выбора пункта меню — закрыть drawer
      document.body.classList.remove('sidebar-open');
      const back = document.getElementById('sidebarBackdrop');
      if (back) back.hidden = true;
    });
  });

  // ===== Mobile sidebar drawer =====
  const _burger = document.getElementById('topbarBurger');
  const _sbBack = document.getElementById('sidebarBackdrop');
  function _toggleSidebar(open) {
    const isOpen = open == null ? !document.body.classList.contains('sidebar-open') : !!open;
    document.body.classList.toggle('sidebar-open', isOpen);
    if (_sbBack) _sbBack.hidden = !isOpen;
    if (_burger) _burger.setAttribute('aria-expanded', String(isOpen));
  }
  if (_burger) _burger.addEventListener('click', () => _toggleSidebar());
  if (_sbBack) _sbBack.addEventListener('click', () => _toggleSidebar(false));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.body.classList.contains('sidebar-open')) _toggleSidebar(false);
  });

  // ===== Auth render =====
  function renderAuth() {
    const user = store.user;
    const access = store.access;

    if (user && access) {
      document.body.classList.remove('guest');
      els.authGuest.hidden = true;
      els.authUser.hidden = false;

      const name = user.full_name || user.email || user.phone || user.id;
      els.userName.textContent = name;
      els.userMeta.textContent = [user.email, user.phone].filter(Boolean).join(' · ') || '—';
      els.userAvatar.textContent = (name || '?')[0].toUpperCase();
      els.userAvatar.style.background = stringToColor(user.id);

      const claims = decodeJwt(access);
      if (claims) {
        els.claimSub.textContent = claims.sub || '—';
        els.claimCompany.textContent = claims.company_id || '—';
        els.claimRole.textContent = claims.role || '—';
        els.claimExp.textContent = claims.exp ? new Date(claims.exp * 1000).toLocaleString() : '—';
      }

      // Sidebar mini
      els.userMini.hidden = false;
      els.userMiniName.textContent = name;
      els.userMiniRole.textContent = (claims && claims.role) ? claims.role : '—';
      els.userMiniAvatar.textContent = (name || '?')[0].toUpperCase();
      els.userMiniAvatar.style.background = stringToColor(user.id);

      // Topbar user
      if (els.topbarUserAvatar) {
        els.topbarUserAvatar.textContent = (name || '?')[0].toUpperCase();
        els.topbarUserAvatar.style.background = stringToColor(user.id);
      }
      if (els.topbarUserName) els.topbarUserName.textContent = name;

      // Role-based UI + RBAC фаза 2: гейтинг кнопок действий по правам
      const role = claims ? claims.role : 'client';
      const canMutate = role === 'owner' || role === 'admin';
      const perms = claims && claims.permissions;
      const can = (key) => role === 'owner' || !perms || perms[key] === true;
      els.addServiceToggle.style.display = (canMutate && can('services.manage')) ? '' : 'none';
      els.addMasterToggle.style.display = canMutate ? '' : 'none';
      [['finAddIncomeBtn', 'finance.manage'], ['finAddExpenseBtn', 'finance.manage'],
       ['finTransferBtn', 'finance.manage'], ['finAddAccountBtn', 'finance.manage']].forEach(([id, key]) => {
        const el = document.getElementById(id);
        if (el) el.style.display = can(key) ? '' : 'none';
      });

      // RBAC фаза 2: гейтинг навигации по правам
      applyNavPermissions(role, perms);

      // Preload data for sidebar counters
      void loadServices();
      void loadMasters();
    } else {
      document.body.classList.add('guest');
      els.authGuest.hidden = false;
      els.authUser.hidden = true;
      els.userMini.hidden = true;
      cachedServices = [];
      cachedMasters = [];
      renderServices();
      renderMasters();
      // На неавторизованном — насильно профиль
      if (currentView !== 'profile') setView('profile');
    }
  }

  // RBAC фаза 2: какие права нужны для пунктов навигации (view → permission).
  // Не гейтим: today, profile, masters, promotion, messages.
  const NAV_PERM = {
    journal: 'bookings.view',
    schedule: 'schedule.view',
    clients: 'clients.view',
    services: 'services.view',
    salary: 'salary.view',
    sales: 'bookings.view',
    analytics: 'analytics.view',
    finance: 'finance.view',
    inventory: 'inventory.view',
    settings: 'settings.manage',
  };
  function hasPerm(perms, key) {
    // owner проверяется отдельно; fail-open если в токене нет прав (старый токен)
    return !perms || perms[key] === true;
  }
  function applyNavPermissions(role, perms) {
    const isOwner = role === 'owner';
    document.querySelectorAll('.nav-item[data-view]').forEach((el) => {
      const key = NAV_PERM[el.dataset.view];
      const allowed = !key || isOwner || hasPerm(perms, key);
      el.style.display = allowed ? '' : 'none';
    });
    // Если текущий раздел скрыт по правам — уводим на «Сегодня»
    const curKey = NAV_PERM[currentView];
    if (curKey && !isOwner && !hasPerm(perms, curKey)) setView('today');
  }

  // ===== Services =====
  async function loadServices() {
    if (!store.access) return;
    const { ok, data } = await apiCall('GET', '/api/salons/services', null);
    if (!ok) return;
    cachedServices = data?.items || [];
    renderServices();
    renderMasters();
  }

  const svcCollapsedGroups = new Set();
  function renderServices() {
    if (!els.servicesCounter) return;
    els.servicesCounter.textContent = String(cachedServices.length);
    if (cachedServices.length === 0) {
      els.servicesList.innerHTML = '<div class="empty">Услуг пока нет.</div>';
      return;
    }
    const commMap = new Map(cachedCommissions.map((c) => [c.service_id, c]));
    const svcRow = (s) => {
      const comm = commMap.get(s.id);
      const commBadge = comm
        ? `<span class="badge badge-green">${comm.commission_type === 'percent' ? comm.amount + '% менеджерам' : fmtMoney(comm.amount) + ' ₽ оформившему'}</span>`
        : '';
      return `
        <div class="row-item clickable ${s.is_active ? '' : 'inactive'}" data-svc-id="${s.id}">
          <div class="dot-color" style="background: ${escapeHtml(s.color || '#7c3aed')}"></div>
          <div class="row-main">
            <div class="row-name">${escapeHtml(s.name)}</div>
            ${commBadge ? `<div class="row-meta">${commBadge}</div>` : ''}
          </div>
          <div class="row-stat">${formatPrice(s.price)} · ${s.duration_minutes} мин</div>
        </div>`;
    };
    // Группировка по группе услуг (category_name); «без группы» — в конец
    const NONE = ' none';
    const groups = new Map();
    for (const s of cachedServices) {
      const key = s.category_name || NONE;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(s);
    }
    const keys = [...groups.keys()].sort((a, b) => {
      if (a === NONE) return 1;
      if (b === NONE) return -1;
      return a.localeCompare(b, 'ru');
    });
    els.servicesList.innerHTML = keys.map((key) => {
      const list = groups.get(key);
      const title = key === NONE ? 'Без группы' : key;
      const collapsed = svcCollapsedGroups.has(key);
      return `
        <div class="svc-group${collapsed ? ' collapsed' : ''}">
          <div class="svc-group-head" data-group-toggle="${escapeHtml(key)}">
            <span class="svc-group-caret">▸</span>
            <span class="svc-group-name">${escapeHtml(title)}</span>
            <span class="svc-group-count">${list.length}</span>
          </div>
          <div class="svc-group-body">${list.map(svcRow).join('')}</div>
        </div>`;
    }).join('');
    els.servicesList.querySelectorAll('[data-group-toggle]').forEach((head) => {
      head.addEventListener('click', () => {
        const key = head.dataset.groupToggle;
        if (svcCollapsedGroups.has(key)) svcCollapsedGroups.delete(key);
        else svcCollapsedGroups.add(key);
        head.closest('.svc-group').classList.toggle('collapsed');
      });
    });
    els.servicesList.querySelectorAll('[data-svc-id]').forEach((row) => {
      row.addEventListener('click', () => openSvcEditModal(row.dataset.svcId));
    });
  }

  async function openSvcEditModal(serviceId) {
    const s = cachedServices.find((x) => x.id === serviceId);
    if (!s) return;
    const comm = cachedCommissions.find((c) => c.service_id === s.id);
    document.getElementById('svcEditId').value = s.id;
    document.getElementById('svcEditTitle').textContent = s.name;
    document.getElementById('svcEditName').value = s.name;
    document.getElementById('svcEditPrice').value = s.price;
    document.getElementById('svcEditDuration').value = s.duration_minutes;
    document.getElementById('svcEditColor').value = s.color || '#93494b';
    document.getElementById('svcEditCommType').value = comm?.commission_type || '';
    document.getElementById('svcEditCommAmount').value = comm?.amount || '';
    document.getElementById('svcEditDesc').value = s.description || '';
    renderSvcPreview(s);
    if (s.video_status === 'processing') pollSvcPreview(s.id, 60); else stopSvcPoll();
    document.getElementById('svcEditError').hidden = true;
    updateSvcCommLabel();
    svcSwitchTab('settings');
    toggleSvcCatAdd(false);
    await populateSvcCategoryDropdown(s.category_id || '');
    document.getElementById('svcEditBackdrop').hidden = false;
    void loadSvcMasters(s.id); // подгрузка вкладки «Сотрудники»
    void loadSvcMaterials(s.id); // подгрузка вкладки «Материалы»
  }

  // ----- Вкладки модалки услуги -----
  function svcSwitchTab(tab) {
    document.querySelectorAll('#svcEditModal .modal-tab').forEach((b) =>
      b.classList.toggle('active', b.dataset.svctab === tab));
    document.querySelectorAll('#svcEditModal .svc-tab-panel').forEach((p) => {
      p.hidden = p.dataset.svcpanel !== tab;
    });
  }
  document.querySelectorAll('#svcEditModal .modal-tab').forEach((b) => {
    b.addEventListener('click', () => svcSwitchTab(b.dataset.svctab));
  });

  // ----- Вкладка «Превью»: описание + видео-ролик + ссылка для клиента -----
  function svcPreviewLink(id) { return `${location.origin}/service.html?id=${id}`; }
  function renderSvcPreview(s) {
    const curEl = document.getElementById('svcPreviewCurrent');
    const delBtn = document.getElementById('svcPreviewDelete');
    const linkWrap = document.getElementById('svcPreviewLinkWrap');
    const fileEl = document.getElementById('svcPreviewFile');
    const progEl = document.getElementById('svcPreviewProgress');
    if (fileEl) fileEl.value = '';
    if (progEl) { progEl.hidden = true; progEl.textContent = ''; }
    const status = s.video_status;
    const hasVideo = !!(s.preview_enabled && s.video_path);
    let txt;
    if (status === 'processing') txt = '⏳ Конвертация видео… (обновится автоматически)';
    else if (status === 'failed') txt = '⚠ Загружено без конвертации — показываем как есть';
    else if (hasVideo) txt = '✓ Видео готово';
    else txt = 'Видео не загружено';
    if (curEl) curEl.textContent = txt;
    if (delBtn) delBtn.hidden = !(hasVideo || status);
    if (linkWrap) linkWrap.hidden = !hasVideo;
    if (hasVideo) {
      const link = svcPreviewLink(s.id);
      document.getElementById('svcPreviewLink').value = link;
      document.getElementById('svcPreviewOpen').href = link;
    }
  }
  // Автообновление статуса, пока идёт фоновая конвертация.
  let _svcPollTimer = null;
  function stopSvcPoll() { if (_svcPollTimer) { clearTimeout(_svcPollTimer); _svcPollTimer = null; } }
  function pollSvcPreview(id, tries) {
    stopSvcPoll();
    if (tries <= 0) return;
    _svcPollTimer = setTimeout(async () => {
      // Останавливаемся, если модалку закрыли или открыли другую услугу.
      if (document.getElementById('svcEditBackdrop').hidden
          || document.getElementById('svcEditId').value !== id) return;
      await loadServices();
      const s = cachedServices.find((x) => x.id === id);
      if (!s) return;
      renderSvcPreview(s);
      if (s.video_status === 'processing') pollSvcPreview(id, tries - 1);
      else if (s.video_status === 'ready') toast('Видео готово');
      else if (s.video_status === 'failed') toast('Видео загружено (без конвертации)');
    }, 4000);
  }
  async function reloadSvcAndPreview(id) {
    await loadServices();
    renderServices();
    const fresh = cachedServices.find((x) => x.id === id);
    if (fresh) renderSvcPreview(fresh);
  }
  // Загрузка видео (multipart, с прогрессом) — отдельным запросом, не через сохранение услуги.
  document.getElementById('svcPreviewUpload')?.addEventListener('click', () => {
    const id = document.getElementById('svcEditId').value;
    const file = document.getElementById('svcPreviewFile').files[0];
    const progEl = document.getElementById('svcPreviewProgress');
    if (!id) return;
    if (!file) { toast('Выберите видеофайл'); return; }
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/salons/services/${id}/preview-video`);
    xhr.setRequestHeader('Authorization', `Bearer ${store.access}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        progEl.hidden = false;
        progEl.textContent = `Загрузка… ${Math.round((e.loaded / e.total) * 100)}%`;
      }
    };
    xhr.onload = async () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        progEl.hidden = true;
        toast('Видео загружено, идёт конвертация');
        await reloadSvcAndPreview(id);
        pollSvcPreview(id, 60); // ~4 мин ожидания конвертации
      } else {
        let msg = `Ошибка ${xhr.status}`;
        try { msg = JSON.parse(xhr.responseText).error || msg; } catch (_e) { /* ignore */ }
        progEl.hidden = false; progEl.textContent = msg;
        toast(msg);
      }
    };
    xhr.onerror = () => { progEl.hidden = false; progEl.textContent = 'Сетевая ошибка'; };
    const fd = new FormData(); fd.append('video', file);
    progEl.hidden = false; progEl.textContent = 'Загрузка… 0%';
    xhr.send(fd);
  });
  document.getElementById('svcPreviewDelete')?.addEventListener('click', async () => {
    const id = document.getElementById('svcEditId').value;
    if (!id) return;
    if (!confirm('Удалить видео-превью услуги?')) return;
    const r = await apiCall('DELETE', `/api/salons/services/${id}/preview-video`, null);
    if (r.ok) { toast('Видео удалено'); await reloadSvcAndPreview(id); }
    else toast(r.data?.error || 'Ошибка удаления');
  });
  document.getElementById('svcPreviewCopy')?.addEventListener('click', async () => {
    const link = document.getElementById('svcPreviewLink').value;
    try { await navigator.clipboard.writeText(link); toast('Ссылка скопирована'); }
    catch (_e) { document.getElementById('svcPreviewLink').select(); toast('Скопируйте вручную'); }
  });

  // Категории услуг нужны не только в карточке услуги, но и в правилах
  // начисления зарплаты — выносим загрузку отдельно.
  async function loadServiceCategories() {
    if (cachedServiceCategories.length) return cachedServiceCategories;
    const r = await setApi('GET', '/categories');
    cachedServiceCategories = r.ok ? (r.data?.items || []) : [];
    return cachedServiceCategories;
  }

  // ----- Группа услуг: dropdown + инлайн-создание -----
  async function populateSvcCategoryDropdown(selectedId) {
    const sel = document.getElementById('svcEditCategory');
    if (!sel) return;
    if (!cachedServiceCategories.length) {
      const r = await setApi('GET', '/categories');
      cachedServiceCategories = r.ok ? (r.data?.items || []) : [];
    }
    sel.innerHTML = '<option value="">— без группы —</option>'
      + cachedServiceCategories.map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('');
    sel.value = selectedId || '';
  }
  function toggleSvcCatAdd(show) {
    const inl = document.getElementById('svcEditCatAddInline');
    if (!inl) return;
    inl.hidden = !show;
    if (show) { const i = document.getElementById('svcEditCatNewName'); if (i) { i.value = ''; i.focus(); } }
  }
  document.getElementById('svcEditCatAddToggle')?.addEventListener('click', () => {
    toggleSvcCatAdd(document.getElementById('svcEditCatAddInline').hidden);
  });
  document.getElementById('svcEditCatAddCancel')?.addEventListener('click', () => toggleSvcCatAdd(false));
  async function saveNewSvcCategory() {
    const inp = document.getElementById('svcEditCatNewName');
    const name = (inp?.value || '').trim();
    if (!name) { toast('Введите название группы'); inp?.focus(); return; }
    const r = await setApi('POST', '/categories', { name });
    if (!r.ok) { toast(r.status === 409 ? 'Группа с таким названием уже есть' : `Ошибка: ${r.data?.error || r.status}`); return; }
    cachedServiceCategories = [];
    await populateSvcCategoryDropdown(r.data?.id || '');
    toggleSvcCatAdd(false);
    toast('Группа создана');
  }
  document.getElementById('svcEditCatAddSave')?.addEventListener('click', saveNewSvcCategory);
  document.getElementById('svcEditCatNewName')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); saveNewSvcCategory(); }
  });

  // ----- Вкладка «Сотрудники»: список мастеров с индивидуальной ценой -----
  async function loadSvcMasters(serviceId) {
    const list = document.getElementById('svcEditMastersList');
    if (list) list.innerHTML = '<div class="empty">Загрузка…</div>';
    const r = await setApi('GET', `/services/${serviceId}/masters`);
    svcEditMasters = r.ok ? (r.data?.items || []) : [];
    renderSvcMasters();
  }
  function renderSvcMasters() {
    const list = document.getElementById('svcEditMastersList');
    if (!list) return;
    if (!svcEditMasters.length) {
      list.innerHTML = '<div class="empty">Сотрудников пока нет. Добавьте их в разделе «Сотрудники».</div>';
      return;
    }
    list.innerHTML = svcEditMasters.map((m) => `
      <label class="svc-master-row">
        <input type="checkbox" class="svc-m-check" data-mid="${escapeHtml(m.master_id)}" ${m.assigned ? 'checked' : ''} />
        <span class="svc-m-name">${escapeHtml(m.display_name || '—')}</span>
        <input type="number" class="svc-m-price" data-mid="${escapeHtml(m.master_id)}" min="0" step="100"
               placeholder="цена ₽" value="${m.custom_price != null ? m.custom_price : ''}" ${m.assigned ? '' : 'disabled'} />
      </label>
    `).join('');
    list.querySelectorAll('.svc-m-check').forEach((cb) => {
      cb.addEventListener('change', () => {
        const price = list.querySelector(`.svc-m-price[data-mid="${cb.dataset.mid}"]`);
        if (price) price.disabled = !cb.checked;
      });
    });
  }

  // ----- Вкладка «Материалы»: техкарта (расходники) -----
  function svcMatNormalize(items) {
    return items.map((i) => `${i.product_id}:${Number(i.qty_per_service)}`).sort().join(',');
  }
  function addSvcMaterialRow(prefill) {
    const list = document.getElementById('svcEditMaterialsList');
    if (!list) return;
    const opts = cachedProducts.filter((p) => p.is_active)
      .map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)} (${escapeHtml(p.unit)})</option>`).join('');
    const row = document.createElement('div');
    row.className = 'recipe-row';
    row.innerHTML = `
      <select class="svc-mat-product" required>${opts}</select>
      <input type="number" class="svc-mat-qty" step="any" min="0.001" required placeholder="кол-во" />
      <button type="button" class="r-del" aria-label="удалить">×</button>`;
    list.appendChild(row);
    if (prefill) {
      row.querySelector('.svc-mat-product').value = prefill.product_id;
      row.querySelector('.svc-mat-qty').value = prefill.qty_per_service;
    }
    row.querySelector('.r-del').addEventListener('click', () => row.remove());
  }
  async function loadSvcMaterials(serviceId) {
    const list = document.getElementById('svcEditMaterialsList');
    if (list) list.innerHTML = '';
    svcEditMaterialsOrig = '';
    if (!cachedProducts.length) {
      const rp = await apiCall('GET', '/api/inventory/products');
      cachedProducts = rp.ok ? (rp.data?.items || []) : [];
    }
    const rt = await apiCall('GET', '/api/inventory/tech-cards');
    const tc = (rt.ok ? (rt.data?.items || []) : []).find((t) => t.service_id === serviceId);
    const items = tc?.items || [];
    svcEditMaterialsOrig = svcMatNormalize(items);
    items.forEach((it) => addSvcMaterialRow(it));
  }
  document.getElementById('svcEditMaterialAdd')?.addEventListener('click', () => {
    if (!cachedProducts.filter((p) => p.is_active).length) {
      toast('Сначала добавьте расходники в разделе «Склад»');
      return;
    }
    addSvcMaterialRow();
  });

  function updateSvcCommLabel() {
    const type = document.getElementById('svcEditCommType')?.value;
    const label = document.getElementById('svcEditCommAmountLabel');
    const wrap = document.getElementById('svcEditCommAmountWrap');
    if (label) label.textContent = type === 'percent' ? 'Размер (%)' : 'Сумма (₽)';
    if (wrap) wrap.hidden = !type;
  }

  document.getElementById('svcEditCommType')?.addEventListener('change', updateSvcCommLabel);
  document.getElementById('svcEditClose')?.addEventListener('click', () => {
    stopSvcPoll();
    document.getElementById('svcEditBackdrop').hidden = true;
  });
  document.getElementById('svcEditCancel')?.addEventListener('click', () => {
    stopSvcPoll();
    document.getElementById('svcEditBackdrop').hidden = true;
  });
  document.getElementById('svcEditBackdrop')?.addEventListener('click', (e) => {
    if (e.target.id === 'svcEditBackdrop') { stopSvcPoll(); document.getElementById('svcEditBackdrop').hidden = true; }
  });
  document.getElementById('svcEditForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('svcEditError');
    errEl.hidden = true;
    const serviceId = document.getElementById('svcEditId').value;
    const fd = new FormData(document.getElementById('svcEditForm'));
    // 1. Обновляем услугу
    const svcPayload = {
      name: fd.get('name'),
      price: parseFloat(fd.get('price')),
      duration_minutes: parseInt(fd.get('duration_minutes')),
      color: fd.get('color') || null,
      category_id: fd.get('category_id') || null,
      description: (fd.get('description') || '').trim() || null,
    };
    const r1 = await apiCall('PATCH', `/api/salons/services/${serviceId}`, svcPayload);
    if (!r1.ok) {
      errEl.textContent = r1.data?.error || 'Ошибка сохранения услуги';
      errEl.hidden = false;
      return;
    }
    // 2. Обновляем комиссию
    const commType = fd.get('commission_type');
    const commAmount = parseFloat(fd.get('commission_amount'));
    const existingComm = cachedCommissions.find((c) => c.service_id === serviceId);
    if (existingComm) {
      // Удаляем старое правило
      await salApi('DELETE', `/commissions/${existingComm.id}`);
    }
    if (commType && !isNaN(commAmount) && commAmount > 0) {
      const r2 = await salApi('POST', '/commissions', {
        service_id: serviceId,
        commission_type: commType,
        amount: commAmount,
      });
      if (!r2.ok) {
        errEl.textContent = r2.data?.error || 'Услуга сохранена, ошибка комиссии';
        errEl.hidden = false;
      }
    }
    // 3. Сохраняем привязку сотрудников (вкладка «Сотрудники»)
    const mList = document.getElementById('svcEditMastersList');
    if (mList && mList.querySelector('.svc-m-check')) {
      const assignments = Array.from(mList.querySelectorAll('.svc-m-check'))
        .filter((cb) => cb.checked)
        .map((cb) => {
          const priceEl = mList.querySelector(`.svc-m-price[data-mid="${cb.dataset.mid}"]`);
          const p = priceEl && priceEl.value !== '' ? parseFloat(priceEl.value) : null;
          return { master_id: cb.dataset.mid, custom_price: (p != null && !isNaN(p)) ? p : null };
        });
      const r3 = await setApi('PUT', `/services/${serviceId}/masters`, { assignments });
      if (!r3.ok) {
        errEl.textContent = r3.data?.error || 'Услуга сохранена, ошибка привязки сотрудников';
        errEl.hidden = false;
        return; // оставляем модалку открытой, чтобы показать ошибку
      }
    }
    // 4. Сохраняем материалы (техкарту), только если изменились
    const matList = document.getElementById('svcEditMaterialsList');
    if (matList) {
      const items = Array.from(matList.querySelectorAll('.recipe-row')).map((row) => ({
        product_id: row.querySelector('.svc-mat-product')?.value,
        qty_per_service: Number(row.querySelector('.svc-mat-qty')?.value),
      })).filter((it) => it.product_id && it.qty_per_service > 0);
      if (items.length && svcMatNormalize(items) !== svcEditMaterialsOrig) {
        const r4 = await apiCall('PUT', '/api/inventory/tech-cards', { service_id: serviceId, items });
        if (!r4.ok) {
          errEl.textContent = r4.data?.error || 'Услуга сохранена, ошибка материалов';
          errEl.hidden = false;
          return;
        }
      }
    }
    document.getElementById('svcEditBackdrop').hidden = true;
    await Promise.all([loadServices(), salLoadCommissions()]);
    renderServices();
  });

  // ===== Masters =====
  async function loadMasters({ force = false } = {}) {
    if (!store.access) return;
    if (!force && cachedMasters.length > 0 && Date.now() - mastersLoadedAt < 5 * 60_000) return;
    const { ok, data } = await apiCall('GET', '/api/salons/masters', null);
    if (!ok) return;
    cachedMasters = data?.items || [];
    mastersLoadedAt = Date.now();
    renderMasters();
  }

  function renderMasters() {
    if (!els.mastersCounter) return;
    els.mastersCounter.textContent = String(cachedMasters.length);
    if (cachedMasters.length === 0) {
      els.mastersList.innerHTML = '<div class="empty">Сотрудников пока нет.</div>';
      return;
    }
    const svcMap = new Map(cachedServices.map((s) => [s.id, s.name]));
    els.mastersList.innerHTML = cachedMasters.map((m) => {
      const name = m.display_name || '—';
      const services = (m.service_ids || []).map((id) => svcMap.get(id) || '?');
      const badges = services.length
        ? `<div class="badges">${services.map((s) => `<span class="badge">${escapeHtml(s)}</span>`).join('')}</div>`
        : '';
      const role = m.position || m.specialization || '';
      const avatar = m.avatar_url
        ? `<div class="user-avatar small" style="background-image:url('${m.avatar_url}');background-size:cover;background-position:center"></div>`
        : `<div class="user-avatar small" style="background: ${stringToColor(m.id)}">${escapeHtml((name || '?')[0].toUpperCase())}</div>`;
      return `
        <div class="row-item clickable ${m.is_active ? '' : 'inactive'}" data-master-id="${escapeHtml(m.id)}">
          ${avatar}
          <div class="row-main">
            <div class="row-name">${escapeHtml(name)}</div>
            <div class="row-meta">${escapeHtml(role)}</div>
            ${badges}
          </div>
        </div>
      `;
    }).join('');

    // Кликабельность — открыть карточку сотрудника
    els.mastersList.querySelectorAll('[data-master-id]').forEach((row) => {
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        void openMasterCard(row.dataset.masterId);
      });
    });
  }

  // ===== Tabs (login/register) =====
  els.tabs.forEach((t) => {
    t.addEventListener('click', () => {
      els.tabs.forEach((x) => x.classList.remove('active'));
      t.classList.add('active');
      els.panes.forEach((p) => p.classList.toggle('active', p.dataset.pane === t.dataset.tab));
      els.authError.hidden = true;
    });
  });

  function showAuthError(msg) {
    els.authError.textContent = msg;
    els.authError.hidden = false;
  }

  // ===== Login =====
  els.loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    els.authError.hidden = true;
    const fd = new FormData(els.loginForm);
    const id = String(fd.get('identifier') || '').trim();
    const password = String(fd.get('password') || '');
    if (!id) { showAuthError('Email или телефон обязательны'); return; }
    const body = { password };
    if (id.includes('@')) body.email = id; else body.phone = id;
    const { ok, status, data } = await call('POST', '/api/auth/login', body);
    if (!ok) { showAuthError(`Ошибка входа: ${data?.error || status}`); return; }
    store.access = data.access_token;
    store.refresh = data.refresh_token;
    store.user = data.user;
    renderAuth();
  });

  // ===== Register =====
  els.registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    els.authError.hidden = true;
    const fd = new FormData(els.registerForm);
    const password = String(fd.get('password') || '');
    const role = String(fd.get('role') || 'client');
    const email = String(fd.get('email') || '').trim();
    const phone = String(fd.get('phone') || '').trim();
    const full_name = String(fd.get('full_name') || '').trim();
    if (!email && !phone) { showAuthError('Нужен email или телефон'); return; }
    const body = { password, role };
    if (email) body.email = email;
    if (phone) body.phone = phone;
    if (full_name) body.full_name = full_name;
    // Токен (если залогинен админ) нужен серверу для выдачи ролей персонала
    const { ok, status, data } = await call('POST', '/api/auth/register', body, store.access);
    if (!ok) { showAuthError(`Ошибка регистрации: ${data?.error || status}`); return; }
    store.access = data.access_token;
    store.refresh = data.refresh_token;
    store.user = data.user;
    renderAuth();
  });

  // ===== Refresh =====
  els.refreshBtn.addEventListener('click', async () => {
    els.userError.hidden = true;
    if (!store.refresh) return;
    const { ok, status, data } = await call('POST', '/api/auth/refresh', { refresh_token: store.refresh });
    if (!ok) {
      els.userError.textContent = `Не удалось обновить (${data?.code || status}). Войдите заново.`;
      els.userError.hidden = false;
      store.clear(); renderAuth();
      return;
    }
    store.access = data.access_token;
    store.refresh = data.refresh_token;
    store.user = data.user;
    renderAuth();
  });

  // ===== Logout =====
  els.logoutBtn.addEventListener('click', async () => {
    if (store.refresh) await call('POST', '/api/auth/logout', { refresh_token: store.refresh });
    store.clear();
    renderAuth();
  });

  // ===== Add service =====
  els.addServiceToggle.addEventListener('click', () => {
    els.addServiceBlock.open = !els.addServiceBlock.open;
  });
  els.addServiceCancel.addEventListener('click', () => {
    els.addServiceBlock.open = false;
    els.addServiceForm.reset();
  });
  els.addServiceForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(els.addServiceForm);
    const body = {
      name: String(fd.get('name') || '').trim(),
      price: Number(fd.get('price')) || 0,
      duration_minutes: Number(fd.get('duration_minutes')) || 60,
    };
    const color = String(fd.get('color') || '').trim();
    if (color) body.color = color;
    const { ok, data, status } = await apiCall('POST', '/api/salons/services', body);
    if (!ok) { toast(`Ошибка создания услуги: ${data?.error || status}`); return; }
    els.addServiceForm.reset();
    els.addServiceBlock.open = false;
    await loadServices();
  });

  // ===== Add master =====
  els.addMasterToggle.addEventListener('click', () => {
    els.addMasterBlock.open = !els.addMasterBlock.open;
  });
  els.addMasterCancel.addEventListener('click', () => {
    els.addMasterBlock.open = false;
    els.addMasterForm.reset();
  });
  els.addMasterForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(els.addMasterForm);
    const body = { display_name: String(fd.get('display_name') || '').trim() };
    const position = String(fd.get('position') || '').trim();
    if (position) body.position = position;
    const phone = String(fd.get('phone') || '').trim();
    if (phone) body.phone = phone;
    // Чекбокс: если снят — provides_services=false
    body.provides_services = document.getElementById('mProvidesServices').checked;
    const { ok, data, status } = await apiCall('POST', '/api/salons/masters', body);
    if (!ok) { toast(`Ошибка создания сотрудника: ${data?.error || status}`); return; }
    els.addMasterForm.reset();
    document.getElementById('mProvidesServices').checked = true; // reset checkbox
    els.addMasterBlock.open = false;
    await loadMasters();
  });

  // ===== Journal (bookings) =====
  async function loadBookings() {
    if (!store.access && !store.refresh) { renderJournal(); return; }
    const { from, to } = getJournalRange();
    const { ok, data } = await apiCall(
      'GET',
      `/api/bookings?from=${from}&to=${to}`,
      null,
    );
    if (!ok) {
      cachedBookings = [];
      renderJournal();
      return;
    }
    cachedBookings = data?.items || [];
    await loadTimeBlocks(from, to);
    renderJournal();
  }

  // «Занятое время» мастеров за тот же период, что и записи.
  async function loadTimeBlocks(from, to) {
    const r = await apiCall('GET', `/api/bookings/blocks?from=${from}&to=${to}`, null);
    cachedTimeBlocks = r.ok ? (r.data?.items || []) : [];
  }

  function applyJournalMode() {
    els.calToggleBtns.forEach((b) => b.classList.toggle('active', b.dataset.mode === journalMode));
    const isList = journalMode === 'list';
    if (els.journalCalendar) els.journalCalendar.hidden = isList;
    if (els.journalList) els.journalList.hidden = !isList;
    if (els.journalFiltersPanel) els.journalFiltersPanel.hidden = !isList;
    if (els.journalCharts) els.journalCharts.hidden = !isList;
  }

  function getFilteredBookings() {
    return cachedBookings.filter((b) => {
      if (jrnSelectedMasters && !jrnSelectedMasters.has(b.master_id)) return false;
      if (!jrnSelectedMasters && journalFilters.master_id && b.master_id !== journalFilters.master_id) return false;
      // Отменённые/«не пришёл» скрыты по умолчанию — видны, только если явно выбран этот статус в фильтре
      if (!journalFilters.status && (b.status === 'canceled' || b.status === 'no_show')) return false;
      if (journalFilters.status && b.status !== journalFilters.status) return false;
      if (journalFilters.source && (b.source || '') !== journalFilters.source) return false;
      if (journalFilters.anon && b.client_phone) return false;
      if (journalFilters.client) {
        const q = journalFilters.client.toLowerCase();
        const hay = `${b.client_name || ''} ${b.client_phone || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  function populateJournalFilters() {
    jrnRenderMasterFilter();
    if (els.filterMaster) {
      const cur = journalFilters.master_id;
      els.filterMaster.innerHTML = '<option value="">Все</option>' +
        cachedMasters.filter((m) => m.provides_services !== false)
          .map((m) => `<option value="${m.id}">${escapeHtml(m.display_name)}</option>`).join('');
      els.filterMaster.value = cur;
    }
    if (els.filterSource) {
      const cur = journalFilters.source;
      const sources = Array.from(new Set(cachedBookings.map((b) => b.source || '').filter(Boolean))).sort();
      const labels = { manual: 'Вручную', widget: 'Виджет', public: 'Публичный', api: 'API' };
      els.filterSource.innerHTML = '<option value="">Все</option>' +
        sources.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(labels[s] || s)}</option>`).join('');
      els.filterSource.value = cur;
    }
  }

  // ===== DIKIDI-style day calendar grid =====
  let _bookingTooltipEl = null;
  function showBookingTooltip(b, anchor) {
    hideBookingTooltip();
    const durMin = Math.round((new Date(b.ends_at) - new Date(b.starts_at)) / 60000);
    const hours = Math.floor(durMin / 60);
    const mins = durMin % 60;
    const durStr = `${hours ? hours + ' ч ' : ''}${mins ? mins + ' мин' : ''}`.trim() || '—';
    const isPaid = !!b.paid_at;

    const tip = document.createElement('div');
    tip.className = 'cal-tooltip';
    tip.innerHTML = `
      <div class="cal-tooltip-row">
        <span class="cal-tooltip-time">${formatTimeRange(b.starts_at, b.ends_at)}</span>
        <span class="cal-tooltip-duration">⏱ ${escapeHtml(durStr)}</span>
      </div>
      <div class="cal-tooltip-row">
        <span class="cal-tooltip-name">${escapeHtml(b.client_name || '—')}</span>
        <span class="cal-tooltip-phone">${escapeHtml(b.client_phone || '')}</span>
      </div>
      ${(b.services || []).map((s) => `<div class="cal-tooltip-svc">${escapeHtml(s.service_name)}${s.price ? ' · <b>' + formatPrice(s.price) + '</b>' : ''}</div>`).join('')}
      ${isPaid ? '<div class="cal-tooltip-paid">✓ Оплачено</div>' : ''}
      ${b.notes ? `<div class="cal-tooltip-note">${escapeHtml(b.notes)}</div>` : ''}
    `;
    document.body.appendChild(tip);
    const r = anchor.getBoundingClientRect();
    const tipR = tip.getBoundingClientRect();
    let left = r.right + 8;
    if (left + tipR.width > window.innerWidth - 12) left = r.left - tipR.width - 8;
    let top = r.top;
    if (top + tipR.height > window.innerHeight - 12) top = window.innerHeight - tipR.height - 12;
    tip.style.left = Math.max(12, left) + 'px';
    tip.style.top = Math.max(12, top) + 'px';
    _bookingTooltipEl = tip;
  }
  function hideBookingTooltip() {
    if (_bookingTooltipEl) { _bookingTooltipEl.remove(); _bookingTooltipEl = null; }
  }

  function renderCalendar() {
    if (!els.journalCalendar) return;
    const masters = cachedMasters.filter((m) => m.is_active && m.provides_services !== false
      && (!jrnSelectedMasters || jrnSelectedMasters.has(m.id)));
    if (masters.length === 0) {
      els.journalCalendar.innerHTML = `
        <div class="cal-empty">
          <div class="cal-empty-icon">
            <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.4">
              <path d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM4 21v-1a7 7 0 0114 0v1" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
          <div class="cal-empty-title">Нет ни одного сотрудника</div>
          <div class="cal-empty-desc">Чтобы журнал стал похож на DIKIDI, добавьте хотя бы одного сотрудника и его расписание.</div>
          <div class="cal-empty-actions">
            <a href="#masters" class="btn-primary btn-sm" data-empty-go="masters">Перейти в «Сотрудники»</a>
            <a href="#schedule" class="btn-secondary btn-sm" data-empty-go="schedule">Открыть «График работы»</a>
          </div>
        </div>
      `;
      els.journalCalendar.querySelectorAll('[data-empty-go]').forEach((a) => {
        a.addEventListener('click', (e) => { e.preventDefault(); setView(a.dataset.emptyGo); });
      });
      return;
    }
    const totalMin = (CAL_END_HOUR - CAL_START_HOUR) * 60;
    const gridHeight = totalMin * CAL_PX_PER_MIN;

    const byMaster = new Map(masters.map((m) => [m.id, []]));
    cachedBookings.forEach((b) => {
      // Отменённые и «не пришёл» не показываем в журнале — они доступны через фильтр по статусу / историю действий
      if (b.status === 'canceled' || b.status === 'no_show') return;
      const arr = byMaster.get(b.master_id);
      if (arr) arr.push(b);
    });

    const grid = document.createElement('div');
    grid.className = 'cal-grid';
    grid.style.gridTemplateColumns = `${CAL_TIME_AXIS_W}px repeat(${masters.length}, minmax(180px, 1fr)) ${CAL_TIME_AXIS_W}px`;
    grid.style.gridTemplateRows = `${CAL_HEAD_H}px ${gridHeight}px`;

    // Top-left corner
    const corner = document.createElement('div');
    corner.className = 'cal-corner';
    corner.style.gridRow = '1'; corner.style.gridColumn = '1';
    grid.appendChild(corner);

    // Master heads
    masters.forEach((m, i) => {
      const head = document.createElement('div');
      head.className = 'cal-master-head';
      head.style.gridRow = '1'; head.style.gridColumn = String(i + 2);
      const initials = (m.display_name || '?').split(' ').map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
      const headAvatar = m.avatar_url
        ? `<div class="cal-master-avatar" style="background-image:url('${m.avatar_url}');background-size:cover;background-position:center;"></div>`
        : `<div class="cal-master-avatar" style="background:${stringToColor(m.id)};color:#fff;">${escapeHtml(initials || '?')}</div>`;
      head.innerHTML = `
        ${headAvatar}
        <div class="cal-master-info">
          <div class="cal-master-name">${escapeHtml(m.display_name || '—')}</div>
          <div class="cal-master-hours">${escapeHtml(m._hours || '10:00 – 20:00')}</div>
        </div>
      `;
      grid.appendChild(head);
    });

    // Top-right corner
    const cornerR = document.createElement('div');
    cornerR.className = 'cal-corner right';
    cornerR.style.gridRow = '1'; cornerR.style.gridColumn = String(masters.length + 2);
    grid.appendChild(cornerR);

    // Left time axis
    const axisL = document.createElement('div');
    axisL.className = 'cal-time-axis';
    axisL.style.gridRow = '2'; axisL.style.gridColumn = '1'; axisL.style.height = gridHeight + 'px';
    for (let h = CAL_START_HOUR; h <= CAL_END_HOUR; h++) {
      const lbl = document.createElement('div');
      lbl.className = 'cal-hour-label';
      lbl.style.top = ((h - CAL_START_HOUR) * CAL_HOUR_H * CAL_PX_PER_MIN) + 'px';
      lbl.textContent = `${String(h).padStart(2, '0')}:00`;
      axisL.appendChild(lbl);
    }
    grid.appendChild(axisL);

    // Master columns
    masters.forEach((m, i) => {
      const col = document.createElement('div');
      col.className = 'cal-master-col';
      col.style.gridRow = '2'; col.style.gridColumn = String(i + 2);
      col.style.height = gridHeight + 'px';
      col.style.cursor = 'pointer';
      col.title = 'Кликните по свободному времени, чтобы создать запись';

      // Клик по пустому месту колонки → поповер с выбором времени начала
      col.addEventListener('click', (e) => {
        if (e.target.closest('.cal-booking')) return; // по существующей записи — не создаём
        if (e.target.closest('.cal-block')) return;   // по занятому времени — тоже
        const rect = col.getBoundingClientRect();
        const y = e.clientY - rect.top;
        let minutes = Math.floor((y / CAL_PX_PER_MIN) / 5) * 5; // снап к 5 мин вниз
        minutes = Math.max(0, minutes);
        const abs = CAL_START_HOUR * 60 + minutes;
        if (Math.floor(abs / 60) > CAL_END_HOUR) return;
        const dateStr = (els.journalDate && els.journalDate.value) || todayLocalISO();
        openSlotPopover(m.id, dateStr, abs, e.clientX, e.clientY);
      });

      // Занятое время мастера — серой штриховкой под записями.
      const dayISO = (els.journalDate && els.journalDate.value) || todayLocalISO();
      cachedTimeBlocks
        .filter((tb) => tb.master_id === m.id && dateToISO(new Date(tb.starts_at)) === dayISO)
        .forEach((tb) => {
          const s = new Date(tb.starts_at);
          const e = new Date(tb.ends_at);
          const sMin = (s.getHours() - CAL_START_HOUR) * 60 + s.getMinutes();
          const eMin = (e.getHours() - CAL_START_HOUR) * 60 + e.getMinutes();
          const el = document.createElement('div');
          el.className = 'cal-block';
          el.style.top = (sMin * CAL_PX_PER_MIN) + 'px';
          el.style.height = Math.max(20, (eMin - sMin) * CAL_PX_PER_MIN) + 'px';
          el.dataset.blockId = tb.id;
          el.title = `Занято${tb.reason ? ': ' + tb.reason : ''} — нажмите, чтобы освободить`;
          if (tb.color) {
            el.style.borderColor = tb.color;
            el.style.background = `${tb.color}22`; // тот же цвет, но полупрозрачный
          }
          const durMin = Math.round((e - s) / 60000);
          const durLabel = durMin >= 60
            ? `${Math.floor(durMin / 60)} ч${durMin % 60 ? ' ' + (durMin % 60) + ' мин' : ''}`
            : `${durMin} мин`;
          el.innerHTML = `
            <div class="cal-block-time">${formatTimeRange(tb.starts_at, tb.ends_at)} · ${durLabel}</div>
            ${tb.reason ? `<div class="cal-block-reason">${escapeHtml(tb.reason)}</div>` : ''}
          `;
          el.addEventListener('click', (ev) => {
            ev.stopPropagation();
            void releaseTimeBlock(tb);
          });
          col.appendChild(el);
        });

      const list = byMaster.get(m.id) || [];
      list.forEach((b) => {
        const start = new Date(b.starts_at);
        const end = new Date(b.ends_at);
        const startMin = (start.getHours() - CAL_START_HOUR) * 60 + start.getMinutes();
        const endMin = (end.getHours() - CAL_START_HOUR) * 60 + end.getMinutes();
        const top = startMin * CAL_PX_PER_MIN;
        const height = Math.max(28, (endMin - startMin) * CAL_PX_PER_MIN);

        const block = document.createElement('div');
        block.className = `cal-booking ${b.status || ''}`;
        block.style.top = top + 'px';
        block.style.height = height + 'px';
        block.dataset.id = b.id;

        const services = (b.services || []).map((s) => s.service_name).join(', ');
        const note = b.notes || '';
        const createdAt = b.created_at ? new Date(b.created_at).getTime() : 0;
        const isNew = createdAt && (Date.now() - createdAt) < 24 * 3600 * 1000;
        const isPaid = !!b.paid_at;

        const badges = [];
        if (note) badges.push(`<span class="cal-badge message" title="есть заметка"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M21 11.5a8.4 8.4 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.4 8.4 0 01-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.4 8.4 0 013.8-.9h.5a8.5 8.5 0 018 8v.5z" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`);
        if (b.status === 'confirmed' || isPaid) badges.push(`<span class="cal-badge confirmed" title="подтверждена"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 12l5 5L20 7" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`);
        if (isNew) badges.push(`<span class="cal-badge new">NEW</span>`);

        const showFull = height >= 56;
        const phoneBlock = showFull && b.client_phone ? `<div class="cal-booking-phone">${escapeHtml(b.client_phone)}</div>` : '';
        const svcBlock = showFull && services ? `<div class="cal-booking-svc">${escapeHtml(services)}</div>` : '';
        const noteBlock = showFull && note && height >= 90 ? `<div class="cal-booking-note">${escapeHtml(note)}</div>` : '';

        block.innerHTML = `
          ${badges.length ? `<div class="cal-booking-badges">${badges.join('')}</div>` : ''}
          <div class="cal-booking-time">${formatTimeRange(b.starts_at, b.ends_at)}</div>
          <div class="cal-booking-name">${escapeHtml(b.client_name || '—')}</div>
          ${phoneBlock}
          ${svcBlock}
          ${noteBlock}
        `;

        // Цвет записи перекрывает статусный фон: администратор пометил визит
        // осознанно, и эта пометка важнее дефолтной раскраски по статусу.
        if (b.color) {
          block.style.background = `${b.color}2e`;
          block.style.borderLeftColor = b.color;
        }

        block.addEventListener('mouseenter', (e) => showBookingTooltip(b, e.currentTarget));
        block.addEventListener('mouseleave', hideBookingTooltip);
        block.addEventListener('click', () => openBookingModal(b));

        col.appendChild(block);
      });

      grid.appendChild(col);
    });

    // Right time axis
    const axisR = document.createElement('div');
    axisR.className = 'cal-time-axis right';
    axisR.style.gridRow = '2'; axisR.style.gridColumn = String(masters.length + 2);
    axisR.style.height = gridHeight + 'px';
    for (let h = CAL_START_HOUR; h <= CAL_END_HOUR; h++) {
      const lbl = document.createElement('div');
      lbl.className = 'cal-hour-label';
      lbl.style.top = ((h - CAL_START_HOUR) * CAL_HOUR_H * CAL_PX_PER_MIN) + 'px';
      lbl.textContent = `${String(h).padStart(2, '0')}:00`;
      axisR.appendChild(lbl);
    }
    grid.appendChild(axisR);

    els.journalCalendar.innerHTML = '';
    els.journalCalendar.appendChild(grid);
  }

  // ===== Mini-calendar (right aside in journal) =====
  function renderMiniCal() {
    if (!els.miniCal) return;
    const selected = els.journalDate.value || todayLocalISO();
    if (!miniCalAnchor) miniCalAnchor = selected.slice(0, 7);
    const [y, m] = miniCalAnchor.split('-').map(Number);
    const first = new Date(y, m - 1, 1);
    const monthName = MONTHS_RU[m - 1];
    const today = todayLocalISO();
    const startDow = (first.getDay() + 6) % 7; // monday-first
    const daysInMonth = new Date(y, m, 0).getDate();
    const prevDays = new Date(y, m - 1, 0).getDate();

    const dows = ['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС'];
    let html = `
      <div class="mini-cal-head">
        <button class="mini-cal-nav" data-mc="prev" type="button" aria-label="Назад">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M15 6l-6 6 6 6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <div class="mini-cal-title">${escapeHtml(monthName)}</div>
        <button class="mini-cal-nav" data-mc="next" type="button" aria-label="Вперёд">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M9 6l6 6-6 6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>
      <div class="mini-cal-grid">
        ${dows.map((d, idx) => `<div class="mini-cal-dow ${idx >= 5 ? 'weekend' : ''}">${d}</div>`).join('')}
    `;
    for (let i = 0; i < startDow; i++) {
      const day = prevDays - startDow + i + 1;
      const prevM = m === 1 ? 12 : m - 1;
      const prevY = m === 1 ? y - 1 : y;
      const iso = `${prevY}-${String(prevM).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      html += `<div class="mini-cal-day outside" data-iso="${iso}">${day}</div>`;
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dt = new Date(y, m - 1, d);
      const dow = dt.getDay();
      const isWk = dow === 0 || dow === 6;
      const isToday = iso === today;
      const isSelected = iso === selected;
      const cls = ['mini-cal-day'];
      if (isWk) cls.push('weekend');
      if (isToday) cls.push('today');
      if (isSelected) cls.push('selected');
      html += `<div class="${cls.join(' ')}" data-iso="${iso}">${d}</div>`;
    }
    const used = startDow + daysInMonth;
    const trail = used % 7 === 0 ? 0 : 7 - (used % 7);
    for (let i = 1; i <= trail; i++) {
      const nextM = m === 12 ? 1 : m + 1;
      const nextY = m === 12 ? y + 1 : y;
      const iso = `${nextY}-${String(nextM).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
      html += `<div class="mini-cal-day outside" data-iso="${iso}">${i}</div>`;
    }
    html += '</div>';
    els.miniCal.innerHTML = html;

    els.miniCal.querySelectorAll('[data-mc]').forEach((b) => {
      b.addEventListener('click', () => {
        const dir = b.dataset.mc;
        const [yy, mm] = miniCalAnchor.split('-').map(Number);
        let nm = mm + (dir === 'next' ? 1 : -1);
        let ny = yy;
        if (nm < 1) { nm = 12; ny--; }
        if (nm > 12) { nm = 1; ny++; }
        miniCalAnchor = `${ny}-${String(nm).padStart(2, '0')}`;
        renderMiniCal();
      });
    });
    els.miniCal.querySelectorAll('.mini-cal-day').forEach((cell) => {
      cell.addEventListener('click', () => {
        const iso = cell.dataset.iso;
        if (!iso) return;
        els.journalDate.value = iso;
        miniCalAnchor = iso.slice(0, 7);
        void loadBookings();
      });
    });
  }

  // ===== Finance widget =====
  function renderFinance() {
    if (!els.financeTotal) return;
    let cash = 0, card = 0;
    cachedBookings.forEach((b) => {
      if (!b.paid_at) return;
      const total = Number(b.total_price) || 0;
      if (b.payment_method === 'cash') cash += total;
      else card += total;
    });
    const total = cash + card;
    els.financeTotal.textContent = total > 0 ? total.toLocaleString('ru-RU') : '0';
    els.financeCash.textContent = cash.toLocaleString('ru-RU');
    els.financeCard.textContent = card.toLocaleString('ru-RU');
    if (els.financeDonutCash) {
      const cashPct = total > 0 ? (cash / total) * 100 : 0;
      els.financeDonutCash.setAttribute('stroke-dasharray', `${cashPct} ${100 - cashPct}`);
    }
  }

  // ===== Date label / nav =====
  function updateJournalDateLabel() {
    if (!els.journalDateLabel) return;
    els.journalDateLabel.textContent = formatRangeLabel(getJournalRange());
    updateJournalPeriodActive();
  }

  // Подсветка пилюль: активная — та, что соответствует текущему период+якорю.
  function updateJournalPeriodActive() {
    if (!els.journalPeriodBtns?.length) return;
    const anchor = els.journalDate.value || todayLocalISO();
    const today = todayLocalISO();
    const tomorrow = addDaysISO(today, 1);
    let active = '';
    if (journalPeriod === 'day' && anchor === today) active = 'today';
    else if (journalPeriod === 'day' && anchor === tomorrow) active = 'tomorrow';
    else if (journalPeriod === 'week') active = 'week';
    else if (journalPeriod === 'month') active = 'month';
    els.journalPeriodBtns.forEach((b) => b.classList.toggle('active', b.dataset.period === active));
  }

  // Стрелки вперёд/назад двигают на 1 единицу периода (день/неделя/месяц).
  function shiftJournalDate(direction) {
    const cur = els.journalDate.value || todayLocalISO();
    let next;
    if (journalPeriod === 'month') {
      const [y, m] = cur.split('-').map(Number);
      const nd = new Date(y, m - 1 + direction, 1);
      next = dateToISO(nd);
    } else {
      const step = journalPeriod === 'week' ? 7 : 1;
      next = addDaysISO(cur, step * direction);
    }
    els.journalDate.value = next;
    miniCalAnchor = next.slice(0, 7);
    void loadBookings();
  }

  function setJournalPeriod(period, anchor) {
    journalPeriod = period;
    localStorage.setItem('journalPeriod', period);
    if (anchor) {
      els.journalDate.value = anchor;
      miniCalAnchor = anchor.slice(0, 7);
    }
    void loadBookings();
  }

  function _renderCalendarLegacy() {
    if (!els.journalCalendar) return;
    const masters = cachedMasters.filter((m) => m.is_active && m.provides_services !== false
      && (!jrnSelectedMasters || jrnSelectedMasters.has(m.id)));
    if (masters.length === 0) {
      els.journalCalendar.innerHTML = '<div class="empty">Сначала добавь хотя бы одного сотрудника.</div>';
      return;
    }
    const totalHeight = (CAL_END_HOUR - CAL_START_HOUR) * 60 * CAL_PX_PER_MIN;
    const masterMap = new Map(masters.map((m) => [m.id, m]));
    const byMaster = new Map(masters.map((m) => [m.id, []]));
    cachedBookings.forEach((b) => {
      if (b.status === 'canceled') return;
      const arr = byMaster.get(b.master_id);
      if (arr) arr.push(b);
    });

    const headerCols = masters.map((m) => {
      const initial = (m.display_name || '?')[0].toUpperCase();
      return `
        <div class="cal-master-head">
          <div class="user-avatar small" style="background: ${stringToColor(m.id)}">${escapeHtml(initial)}</div>
          <div class="cal-master-name">${escapeHtml(m.display_name)}</div>
        </div>`;
    }).join('');

    const hourLabels = [];
    for (let h = CAL_START_HOUR; h < CAL_END_HOUR; h++) {
      hourLabels.push(`<div class="cal-hour-label" style="height: ${60 * CAL_PX_PER_MIN}px">${String(h).padStart(2, '0')}:00</div>`);
    }

    const masterCols = masters.map((m) => {
      const bookings = byMaster.get(m.id) || [];
      const blocks = bookings.map((b) => {
        const start = new Date(b.starts_at);
        const end = new Date(b.ends_at);
        const startMin = (start.getHours() - CAL_START_HOUR) * 60 + start.getMinutes();
        const durMin = Math.max(15, (end - start) / 60_000);
        const top = startMin * CAL_PX_PER_MIN;
        const height = durMin * CAL_PX_PER_MIN;
        const color = (b.services?.[0]?.color)
          || stringToColor((b.services?.[0]?.service_id || b.id) + 'svc');
        const services = (b.services || []).map((s) => s.service_name).join(', ');
        const isPending = b.status === 'pending';
        const isDone = b.status === 'completed';
        const startStr = `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`;
        const endStr = `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`;
        return `
          <div class="cal-booking ${isPending ? 'pending' : ''} ${isDone ? 'done' : ''}"
               style="top: ${top}px; height: ${height}px; background: ${color}22; border-left-color: ${color};"
               data-id="${b.id}"
               title="${escapeHtml(b.client_name || '')} · ${escapeHtml(b.client_phone || '')}\n${escapeHtml(services)}\n${startStr}-${endStr}\n${formatPrice(b.total_price)}\nstatus: ${escapeHtml(b.status)}">
            <div class="cal-booking-time">${startStr}–${endStr}</div>
            <div class="cal-booking-name">${escapeHtml(b.client_name || '—')}</div>
            <div class="cal-booking-svc">${escapeHtml(services || '')}</div>
            ${isPending ? '<div class="cal-booking-badge">NEW</div>' : ''}
          </div>`;
      }).join('');
      const lines = [];
      for (let h = CAL_START_HOUR + 1; h < CAL_END_HOUR; h++) {
        lines.push(`<div class="cal-hour-line" style="top: ${(h - CAL_START_HOUR) * 60 * CAL_PX_PER_MIN}px"></div>`);
      }
      for (let h = CAL_START_HOUR; h < CAL_END_HOUR; h++) {
        lines.push(`<div class="cal-half-line" style="top: ${((h - CAL_START_HOUR) * 60 + 30) * CAL_PX_PER_MIN}px"></div>`);
      }
      return `
        <div class="cal-master-col" data-master-id="${m.id}" style="height: ${totalHeight}px">
          ${lines.join('')}
          ${blocks}
        </div>`;
    }).join('');

    els.journalCalendar.innerHTML = `
      <div class="cal-grid" style="grid-template-columns: 60px repeat(${masters.length}, 1fr)">
        <div class="cal-corner"></div>
        ${headerCols}
        <div class="cal-time-axis">${hourLabels.join('')}</div>
        ${masterCols}
      </div>`;

    els.journalCalendar.querySelectorAll('.cal-booking').forEach((blk) => {
      blk.addEventListener('click', () => {
        const id = blk.getAttribute('data-id');
        const b = cachedBookings.find((x) => x.id === id);
        if (!b) return;
        const master = masterMap.get(b.master_id);
        const lines = [
          `${b.client_name || '—'} · ${b.client_phone || ''}`,
          `${master?.display_name || ''}`,
          `${(b.services || []).map((s) => s.service_name).join(', ')}`,
          `${new Date(b.starts_at).toLocaleString('ru-RU')} → ${new Date(b.ends_at).toLocaleTimeString('ru-RU').slice(0, 5)}`,
          `Сумма: ${formatPrice(b.total_price)}`,
          `Статус: ${b.status}`,
        ];
        if (b.notes) lines.push(`Заметка: ${b.notes}`);
        toast(lines.join('\n'));
      });
    });
  }

  function renderJournal() {
    if (!els.journalCounter) return;
    els.journalCounter.textContent = String(cachedBookings.length);
    updateJournalDateLabel();
    applyJournalMode();
    populateJournalFilters();
    renderCalendar();
    renderMiniCal();
    renderFinance();
    const filtered = getFilteredBookings();
    renderJournalCharts(filtered);
    if (cachedBookings.length === 0) {
      els.journalList.innerHTML = '<div class="empty">На этот период записей нет.</div>';
      return;
    }
    if (filtered.length === 0) {
      els.journalList.innerHTML = '<div class="empty">Под фильтры ничего не подходит.</div>';
      return;
    }
    const masterMap = new Map(cachedMasters.map((m) => [m.id, m.display_name]));
    const showDate = journalPeriod !== 'day';
    els.journalList.innerHTML = filtered.map((b) => {
      const master = masterMap.get(b.master_id) || '?';
      const services = (b.services || []).map((s) => escapeHtml(s.service_name)).join(', ');
      const status = STATUS_LABEL[b.status] || { ru: b.status, cls: 'pill-mute', icon: '' };
      const isActive = b.status === 'pending' || b.status === 'confirmed';
      const payBadge = b.status === 'completed' && b.payment_method
        ? `<span class="pay-badge pay-${b.payment_method}">${{ cash: 'Нал', card: 'Карта', online: 'Онлайн', balance: 'Баланс' }[b.payment_method] || ''}</span>`
        : '';
      const actions = isActive
        ? `<button class="btn-ghost btn-xs" data-action="cancel" data-id="${b.id}">Отменить</button>
           <button class="btn-secondary btn-xs" data-action="complete" data-id="${b.id}">Завершить</button>`
        : '';
      const startD = new Date(b.starts_at);
      const datePrefix = showDate
        ? `<span class="booking-date">${startD.getDate()} ${MONTHS_RU_GENITIVE[startD.getMonth()]}</span> `
        : '';
      return `
        <div class="row-item booking-row ${isActive ? '' : 'inactive'} status-${b.status}" data-booking-id="${b.id}">
          <div class="booking-time">${datePrefix}${formatTimeRange(b.starts_at, b.ends_at)}</div>
          <div class="row-main">
            <div class="row-name">${escapeHtml(b.client_name || '—')} · ${escapeHtml(b.client_phone || '')}</div>
            <div class="row-meta">${escapeHtml(master)} · ${services}</div>
          </div>
          <div class="booking-right">
            <div class="row-stat">${formatPrice(b.total_price)}${payBadge}</div>
            <span class="status-pill ${status.cls}">${escapeHtml(status.ru)}</span>
          </div>
          ${actions ? `<div class="booking-actions">${actions}</div>` : ''}
        </div>
      `;
    }).join('');

    els.journalList.querySelectorAll('button[data-action]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const action = btn.getAttribute('data-action');
        if (!id) return;
        if (action === 'cancel') {
          if (!confirm('Отменить запись?')) return;
          const { ok, status, data } = await apiCall('POST', `/api/bookings/${id}/cancel`, {});
          if (!ok) { toast(`Ошибка: ${data?.error || status}`); return; }
        } else if (action === 'complete') {
          const { ok, status, data } = await apiCall('POST', `/api/bookings/${id}/complete`, {});
          if (!ok) { toast(`Ошибка: ${data?.error || status}`); return; }
        }
        await loadBookings();
      });
    });

    els.journalList.querySelectorAll('.booking-row[data-booking-id]').forEach((row) => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        const b = cachedBookings.find((x) => x.id === row.dataset.bookingId);
        if (b) openBookingModal(b);
      });
    });
  }

  // ===== Journal charts (4 donuts in list mode) =====
  const CHART_PALETTE = ['#7c3aed', '#22c5d8', '#22c55e', '#f59e0b', '#ec4899', '#94a3b8'];
  // Палитры по типу графика, как у DIKIDI:
  // masters — мягкие пастельные (голубой → розовый → зелёный → лавандовый → персиковый)
  // services — насыщенные разноцветные (синий, жёлтый, фиолетовый, мятный, оранжевый)
  // sources — оттенки красного (один источник = монотон)
  // types — оттенки зелёного
  const CHART_PALETTES = {
    masters:  ['#5dade2', '#ec7ab7', '#82c995', '#a78bfa', '#f4a261', '#f1c40f'],
    services: ['#3b82f6', '#facc15', '#a855f7', '#5eead4', '#fb923c', '#f472b6'],
    sources:  ['#ef4444', '#f87171', '#fca5a5', '#fecaca', '#fed7d7', '#fee2e2'],
    types:    ['#16a34a', '#22c55e', '#4ade80', '#86efac', '#bbf7d0', '#dcfce7'],
  };
  function paletteFor(kind) { return CHART_PALETTES[kind] || CHART_PALETTE; }

  function aggregateTop(items, keyFn, labelFn, limit = 5) {
    const counts = new Map();
    items.forEach((b) => {
      const keys = keyFn(b);
      (Array.isArray(keys) ? keys : [keys]).forEach((k) => {
        if (!k) return;
        counts.set(k, (counts.get(k) || 0) + 1);
      });
    });
    const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
    const top = sorted.slice(0, limit).map(([k, n]) => ({ key: k, label: labelFn(k), value: n }));
    const restSum = sorted.slice(limit).reduce((acc, [, n]) => acc + n, 0);
    if (restSum > 0) top.push({ key: '__rest', label: 'Остальные', value: restSum });
    return top;
  }

  // Рендерит donut в svg по {label, value} массиву. Сегмент = stroke-dasharray на круге.
  // Палитра по типу графика (masters/services/sources/types) — как в DIKIDI у каждой карточки своя.
  // Без числа в центре (DIKIDI его не показывает).
  function renderDonut(svg, segments, total, kind) {
    if (!svg) return;
    const palette = paletteFor(kind);
    if (!total || segments.length === 0) {
      svg.innerHTML = `<circle cx="21" cy="21" r="15.915" fill="none" stroke="#e5e7eb" stroke-width="5.4"/>`;
      return;
    }
    let offset = 25; // визуальный поворот — старт сверху
    const arcs = segments.map((s, i) => {
      const len = (s.value / total) * 100;
      const arc = `<circle cx="21" cy="21" r="15.915" fill="none"
        stroke="${palette[i % palette.length]}" stroke-width="5.4"
        stroke-dasharray="${len.toFixed(2)} ${(100 - len).toFixed(2)}"
        stroke-dashoffset="${offset.toFixed(2)}"
        stroke-linecap="butt"/>`;
      offset = (offset - len + 100) % 100;
      return arc;
    }).join('');
    svg.innerHTML = `
      <circle cx="21" cy="21" r="15.915" fill="none" stroke="#f1f5f9" stroke-width="5.4"/>
      ${arcs}`;
  }

  function renderLegend(ul, segments, kind) {
    if (!ul) return;
    const palette = paletteFor(kind);
    if (segments.length === 0) {
      ul.innerHTML = '<li class="legend-empty">нет данных</li>';
      return;
    }
    ul.innerHTML = segments.map((s, i) => `
      <li>
        <span class="dot" style="background:${palette[i % palette.length]}"></span>
        <span class="legend-label">${escapeHtml(s.label)}</span>
        <span class="legend-val">${s.value}</span>
      </li>
    `).join('');
  }

  function renderJournalCharts(filtered) {
    if (!els.journalCharts) return;
    const masterMap = new Map(cachedMasters.map((m) => [m.id, m.display_name]));
    const masterAgg = aggregateTop(filtered, (b) => b.master_id, (k) => masterMap.get(k) || '—');
    const serviceAgg = aggregateTop(
      filtered,
      (b) => (b.services || []).map((s) => s.service_id),
      (k) => {
        for (const b of filtered) {
          const s = (b.services || []).find((x) => x.service_id === k);
          if (s) return s.service_name;
        }
        return '—';
      },
    );
    const sourceLabels = { manual: 'Вручную', widget: 'Виджет', public: 'Публичный', api: 'API', ios: 'Приложение iOS', android: 'Приложение Android' };
    const sourceAgg = aggregateTop(filtered, (b) => b.source || 'manual', (k) => sourceLabels[k] || k);
    // Типы записей — пока есть только один тип «Личный кабинет», но если backend пришлёт type — отрисуем.
    const typeLabels = { lk: 'Личный кабинет', online: 'Онлайн', walk_in: 'С улицы', repeat: 'Повторная' };
    const typeAgg = aggregateTop(filtered, (b) => b.type || 'lk', (k) => typeLabels[k] || k);

    const total = filtered.length;
    renderDonut(els.journalCharts.querySelector('[data-chart="masters"]'), masterAgg, total, 'masters');
    renderLegend(els.legendMasters, masterAgg, 'masters');
    renderDonut(els.journalCharts.querySelector('[data-chart="services"]'), serviceAgg, serviceAgg.reduce((a, s) => a + s.value, 0), 'services');
    renderLegend(els.legendServices, serviceAgg, 'services');
    renderDonut(els.journalCharts.querySelector('[data-chart="sources"]'), sourceAgg, total, 'sources');
    renderLegend(els.legendSources, sourceAgg, 'sources');

    // 4-я карточка — типы записей. Если в HTML она была-заглушка с «Phase 1» — заменим на нормальную.
    const typesCard = els.journalCharts.querySelector('.chart-card:nth-child(4) .chart-card-body');
    if (typesCard) {
      typesCard.classList.remove('chart-card-empty');
      typesCard.innerHTML = `
        <svg class="donut-svg" viewBox="0 0 42 42" width="120" height="120" data-chart="types"></svg>
        <ul class="chart-legend" id="legendTypes"></ul>
      `;
      renderDonut(typesCard.querySelector('[data-chart="types"]'), typeAgg, total, 'types');
      renderLegend(typesCard.querySelector('#legendTypes'), typeAgg, 'types');
    }
  }

  // ===== Booking view modal =====

  let _bkModalCurrent = null;

  function openBookingModal(b) {
    _bkModalCurrent = b;
    const masterName = (new Map(cachedMasters.map((m) => [m.id, m.display_name]))).get(b.master_id) || '—';
    const status = STATUS_LABEL[b.status] || { ru: b.status, cls: 'pill-mute' };
    const isCanceled = b.status === 'canceled' || b.status === 'no_show';

    if (els.bkModalDot) els.bkModalDot.style.background = STATUS_COLOR[b.status] || '#94a3b8';

    const startD = new Date(b.starts_at);
    const dateStr = `${startD.getDate()} ${MONTHS_RU_GENITIVE[startD.getMonth()]} ${startD.getFullYear()}`;
    els.bkModalTitle.textContent = `${dateStr} · ${formatTimeRange(b.starts_at, b.ends_at)}`;
    els.bkModal.classList.toggle('is-canceled', isCanceled);

    const svcRows = (b.services || []).map((s) => `
      <tr>
        <td>${escapeHtml(s.service_name)}</td>
        <td>${s.price ? formatPrice(s.price) : '—'}</td>
      </tr>
    `).join('');
    const totalRow = b.total_price
      ? `<tr><td><b>Итого</b></td><td><b>${formatPrice(b.total_price)}</b></td></tr>` : '';

    els.bkModalBody.innerHTML = `
      <div class="bk-meta">
        <span class="bk-meta-label">Статус</span>
        <span class="bk-meta-val"><span class="status-pill ${status.cls}">${escapeHtml(status.ru)}</span></span>
        <span class="bk-meta-label">Сотрудник</span>
        <span class="bk-meta-val">${escapeHtml(masterName)}</span>
        <span class="bk-meta-label">Клиент</span>
        <span class="bk-meta-val">${escapeHtml(b.client_name || '—')}</span>
        <span class="bk-meta-label">Телефон</span>
        <span class="bk-meta-val">${escapeHtml(b.client_phone || '—')}</span>
        ${b.notes ? `<span class="bk-meta-label">Заметка</span><span class="bk-meta-val">${escapeHtml(b.notes)}</span>` : ''}
        <span class="bk-meta-label">Источник</span>
        <span class="bk-meta-val">${escapeHtml(SOURCE_LABEL[b.source] || b.source || 'Вручную')}</span>
        ${b.payment_method ? `<span class="bk-meta-label">Оплата</span><span class="bk-meta-val">${{ cash: '✓ Наличные', card: '✓ Карта', online: '✓ Онлайн', balance: '✓ С баланса' }[b.payment_method] || b.payment_method}</span>` : ''}
        ${b.discount_pct > 0 ? `<span class="bk-meta-label">Скидка</span><span class="bk-meta-val">${b.discount_pct}%</span>` : ''}
      </div>
      ${svcRows ? `
        <table class="bk-svc-table">
          <thead><tr><th>Услуга</th><th style="text-align:right">Цена</th></tr></thead>
          <tbody>${svcRows}</tbody>
          ${totalRow ? `<tfoot>${totalRow}</tfoot>` : ''}
        </table>
      ` : ''}
    `;

    const isActive = ['pending', 'confirmed'].includes(b.status);
    if (els.bkModalRepeat) els.bkModalRepeat.hidden = !isCanceled;
    const completeBtn = document.getElementById('bkModalComplete');
    if (completeBtn) completeBtn.hidden = !isActive;
    const confirmBtn = document.getElementById('bkModalConfirm');
    if (confirmBtn) confirmBtn.hidden = b.status !== 'pending';
    const cancelBtn2 = document.getElementById('bkModalCancel2');
    if (cancelBtn2) cancelBtn2.hidden = !isActive;
    const noShowBtn = document.getElementById('bkModalNoShow');
    if (noShowBtn) noShowBtn.hidden = !isActive;
    // Пополнить лицевой счёт — если запись привязана к клиенту и роль admin/owner
    // (эндпоинт /balance/topup требует admin/owner — не показываем «мёртвую» кнопку мастеру).
    const topupRole = (decodeJwt(store.access) || {}).role;
    const canTopup = topupRole === 'owner' || topupRole === 'admin';
    const topupBtn = document.getElementById('bkModalTopup');
    if (topupBtn) topupBtn.hidden = !(b.client_id && canTopup);
    // Изменить можно только незавершённую запись: суммы завершённой уже ушли
    // в выручку, зарплату и финансовые операции — сервер такую правку отклонит.
    const editBtn = document.getElementById('bkModalEdit');
    if (editBtn) editBtn.hidden = !(isActive && canTopup);
    if (els.bkModalBackdrop) els.bkModalBackdrop.hidden = false;
    els.bkModal.hidden = false;
    _bkModalRelease = trapFocus(els.bkModal);
  }

  let _bkModalRelease = null;
  function closeBookingModal() {
    _bkModalCurrent = null;
    if (els.bkModalBackdrop) els.bkModalBackdrop.hidden = true;
    if (els.bkModal) els.bkModal.hidden = true;
    if (_bkModalRelease) { _bkModalRelease(); _bkModalRelease = null; }
  }

  // ===== Модальное окно «Новая запись» / «Изменение записи» =====
  let _addBookingRelease = null;
  // id редактируемой записи; null — создаём новую.
  let editingBookingId = null;

  function openEditBooking(b) {
    closeBookingModal();
    // Порядок важен: resetBookingForm() обнуляет editingBookingId, поэтому
    // сначала чистим форму и только потом помечаем режим правки. Иначе
    // сохранение уходило в POST и создавало дубль на занятое время.
    resetBookingForm();
    editingBookingId = b.id;
    openAddBookingModal();
    setAddBookingMode('booking');
    // Форма заполняется после populateBookingForm — она перерисовывает
    // селекты мастеров и список услуг асинхронно при первой загрузке.
    setTimeout(() => {
      const pad = (n) => String(n).padStart(2, '0');
      const start = new Date(b.starts_at);
      if (els.bMaster) els.bMaster.value = b.master_id;
      if (els.bDate) els.bDate.value = dateToISO(start);
      if (els.bTime) els.bTime.value = `${pad(start.getHours())}:${pad(start.getMinutes())}`;
      const phoneEl = document.getElementById('bPhone');
      const nameEl = document.getElementById('bName');
      if (phoneEl) phoneEl.value = b.client_phone || '';
      if (nameEl) nameEl.value = b.client_name || '';
      _clientSelectedLabel = clientLabel(b);
      if (els.bClientSearch) els.bClientSearch.value = _clientSelectedLabel;
      if (els.bManager && b.manager_id) els.bManager.value = b.manager_id;
      const notesEl = document.getElementById('bNotes');
      if (notesEl) notesEl.value = b.notes || '';

      // Услуги: отмечаем и подставляем цены записи, а не текущий прайс —
      // иначе редактирование молча переоценит запись по новому прайсу.
      // Цены берём из записи, а не из прайса: открытие на редактирование не
      // должно молча переоценить запись по новым ценам.
      svcRows = (b.services || []).map((s) => ({
        service_id: s.service_id,
        price: Number(s.price),
        discountPct: 0,
        duration: s.duration_minutes,
      }));
      renderServiceRows();
      selectedBookingColor = b.color || null;
      renderBookingColors();

      const title = document.getElementById('addBookingTitle');
      if (title) title.textContent = 'Изменение записи';
      const submit = document.getElementById('addBookingSubmit');
      if (submit) submit.textContent = 'Сохранить';
      // Занимать время в режиме правки нечего — вкладку прячем.
      const tabs = document.getElementById('addBookingTabs');
      if (tabs) tabs.hidden = true;
    }, 60);
  }

  function openAddBookingModal() {
    populateBookingForm();
    // Палитра рисуется здесь, а не только в resetBookingForm: открытие через
    // клик по слоту сброс формы не делает, и палитра оставалась пустой.
    renderBookingColors();
    if (els.addBookingBackdrop) els.addBookingBackdrop.hidden = false;
    if (els.addBookingBlock) {
      els.addBookingBlock.hidden = false;
      _addBookingRelease = trapFocus(els.addBookingBlock);
    }
  }

  function closeAddBookingModal() {
    if (els.addBookingBackdrop) els.addBookingBackdrop.hidden = true;
    if (els.addBookingBlock) els.addBookingBlock.hidden = true;
    if (_addBookingRelease) { _addBookingRelease(); _addBookingRelease = null; }
    closeClientSuggest();
  }

  const isAddBookingOpen = () => els.addBookingBlock && !els.addBookingBlock.hidden;

  // ===== Поповер свободного слота (как в DIKIDI) =====
  // Клик по пустому месту в календаре не должен сразу открывать большую форму:
  // сначала уточняем минуты и выбираем, что делать — записать клиента или занять время.
  let _slotCtx = null; // { masterId, dateStr, minutes }

  const minutesToHHMM = (abs) =>
    `${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;

  function openSlotPopover(masterId, dateStr, absMinutes, clientX, clientY) {
    const pop = document.getElementById('slotPopover');
    const times = document.getElementById('slotPopoverTimes');
    if (!pop || !times) return;
    _slotCtx = { masterId, dateStr, minutes: absMinutes };

    // Три варианта с шагом 5 минут — попасть точно в 14:05 мышью нереально.
    const options = [absMinutes, absMinutes + 5, absMinutes + 10]
      .filter((m) => Math.floor(m / 60) <= CAL_END_HOUR);
    times.innerHTML = options.map((m, i) => `
      <button type="button" class="slot-time${i === 0 ? ' active' : ''}" data-min="${m}">${minutesToHHMM(m)}</button>
    `).join('');

    pop.hidden = false;
    // Позиционируем у курсора, но не даём вылезти за экран.
    const rect = pop.getBoundingClientRect();
    const left = Math.min(clientX + 8, window.innerWidth - rect.width - 12);
    const top = Math.min(clientY + 8, window.innerHeight - rect.height - 12);
    pop.style.left = Math.max(12, left) + 'px';
    pop.style.top = Math.max(12, top) + 'px';
  }

  function closeSlotPopover() {
    const pop = document.getElementById('slotPopover');
    if (pop) pop.hidden = true;
    _slotCtx = null;
  }

  document.getElementById('slotPopoverTimes')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.slot-time');
    if (!btn || !_slotCtx) return;
    _slotCtx.minutes = Number(btn.dataset.min);
    document.querySelectorAll('#slotPopoverTimes .slot-time')
      .forEach((b) => b.classList.toggle('active', b === btn));
  });

  document.getElementById('slotPopoverAdd')?.addEventListener('click', () => {
    if (!_slotCtx) return;
    const { masterId, dateStr, minutes } = _slotCtx;
    closeSlotPopover();
    openNewBookingAt(masterId, dateStr, minutesToHHMM(minutes));
  });

  document.getElementById('slotPopoverBlock')?.addEventListener('click', () => {
    if (!_slotCtx) return;
    const { masterId, dateStr, minutes } = _slotCtx;
    closeSlotPopover();
    openNewBookingAt(masterId, dateStr, minutesToHHMM(minutes));
    setTimeout(() => setAddBookingMode('block'), 10);
  });

  document.addEventListener('click', (e) => {
    const pop = document.getElementById('slotPopover');
    if (!pop || pop.hidden) return;
    if (pop.contains(e.target) || e.target.closest('.cal-master-col')) return;
    closeSlotPopover();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSlotPopover(); });

  // ===== Режим модалки: запись клиента или «занять время» =====
  let addBookingMode = 'booking';

  // Палитра меток занятого времени — как в DIKIDI: цветом кодируют причину.
  const BLOCK_COLORS = ['#9aa0a6', '#4c8bf5', '#34a853', '#fbbc04', '#ea4335', '#a142f4', '#00acc1', '#f57c00'];
  let selectedBlockColor = BLOCK_COLORS[0];

  function renderBlockColors() {
    const host = document.getElementById('bBlockColors');
    if (!host) return;
    host.innerHTML = BLOCK_COLORS.map((c) => `
      <button type="button" class="color-dot${c === selectedBlockColor ? ' active' : ''}"
              data-color="${c}" style="background:${c}" aria-label="Цвет ${c}"></button>
    `).join('');
  }

  // Цвет самой записи — та же палитра, но «без цвета» по умолчанию: красить
  // каждую запись необязательно, цветом помечают только особые визиты.
  let selectedBookingColor = null;

  function renderBookingColors() {
    const host = document.getElementById('bBookingColors');
    if (!host) return;
    const check = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 12l5 5L20 7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    host.innerHTML = `
      <button type="button" class="bk-color bk-color--none${selectedBookingColor === null ? ' is-selected' : ''}"
              data-color="" title="Без цвета" aria-label="Без цвета"></button>
    ` + BLOCK_COLORS.map((c) => `
      <button type="button" class="bk-color${c === selectedBookingColor ? ' is-selected' : ''}"
              data-color="${c}" style="background:${c}" aria-label="Цвет ${c}">${c === selectedBookingColor ? check : ''}</button>
    `).join('');
  }

  document.getElementById('bBookingColors')?.addEventListener('click', (e) => {
    const dot = e.target.closest('.bk-color');
    if (!dot) return;
    selectedBookingColor = dot.dataset.color || null;
    renderBookingColors();
  });

  document.getElementById('bBlockColors')?.addEventListener('click', (e) => {
    const dot = e.target.closest('.color-dot');
    if (!dot) return;
    selectedBlockColor = dot.dataset.color;
    renderBlockColors();
  });

  function setAddBookingMode(mode) {
    addBookingMode = mode === 'block' ? 'block' : 'booking';
    const isBlock = addBookingMode === 'block';
    els.addBookingBlock?.querySelectorAll('.booking-only')
      .forEach((el) => { el.hidden = isBlock; });
    els.addBookingBlock?.querySelectorAll('.block-only')
      .forEach((el) => { el.hidden = !isBlock; });
    // required на скрытом поле блокирует submit с непонятной ошибкой браузера.
    const phone = document.getElementById('bPhone');
    if (phone) phone.required = !isBlock;

    const title = document.getElementById('addBookingTitle');
    if (title) title.textContent = isBlock ? 'Занять время' : 'Новая запись';
    const submit = document.getElementById('addBookingSubmit');
    if (submit) submit.textContent = isBlock ? 'Занять' : 'Создать';
    document.querySelectorAll('#addBookingTabs .tab-btn').forEach((b) => {
      b.classList.toggle('tab-btn--active', b.dataset.mode === addBookingMode);
    });
    if (isBlock) { closeClientSuggest(); renderBlockColors(); }
  }

  document.getElementById('addBookingTabs')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.tab-btn');
    if (!btn) return;
    setAddBookingMode(btn.dataset.mode);
  });

  async function releaseTimeBlock(tb) {
    const label = `${formatTimeRange(tb.starts_at, tb.ends_at)}${tb.reason ? ' · ' + tb.reason : ''}`;
    if (!confirm(`Освободить время ${label}?`)) return;
    const { ok, data, status } = await apiCall('DELETE', `/api/bookings/blocks/${tb.id}`, null);
    if (!ok) { toast(`Не удалось освободить: ${data?.error || status}`); return; }
    toast('Время освобождено');
    await loadBookings();
  }

  // Открыть форму новой записи с подставленными мастером, датой и временем
  // (клик по пустой ячейке в журнале).
  function openNewBookingAt(masterId, dateStr, timeStr) {
    openAddBookingModal();
    setTimeout(() => {
      if (els.bMaster) els.bMaster.value = masterId;
      if (els.bDate) els.bDate.value = dateStr;
      if (els.bTime) els.bTime.value = timeStr;
      els.bClientSearch?.focus();
    }, 0);
  }

  function repeatBooking(b) {
    closeBookingModal();
    openAddBookingModal();
    setTimeout(() => {
      if (els.bMaster) els.bMaster.value = b.master_id;
      const origStart = new Date(b.starts_at);
      const timeStr = `${String(origStart.getHours()).padStart(2, '0')}:${String(origStart.getMinutes()).padStart(2, '0')}`;
      if (els.bDate) els.bDate.value = addDaysISO(todayLocalISO(), 1);
      if (els.bTime) els.bTime.value = timeStr;
      const bPhoneEl = document.getElementById('bPhone');
      if (bPhoneEl) bPhoneEl.value = b.client_phone || '';
      const bNameEl = document.getElementById('bName');
      if (bNameEl) bNameEl.value = b.client_name || '';
      _clientSelectedLabel = clientLabel(b);
      if (els.bClientSearch) els.bClientSearch.value = _clientSelectedLabel;
      const bNotesEl = document.getElementById('bNotes');
      if (bNotesEl) bNotesEl.value = b.notes || '';
      const serviceIds = new Set((b.services || []).map((s) => s.service_id));
      svcRows = (b.services || []).map((s) => ({
        service_id: s.service_id,
        price: Number(s.price),
        discountPct: 0,
        duration: s.duration_minutes,
      }));
      renderServiceRows();
    }, 30);
  }

  function populateBookingForm() {
    if (!cachedMasters.length || !cachedServices.length) {
      void Promise.all([loadMasters(), loadServices()]).then(populateBookingForm);
    }
    els.bMaster.innerHTML = cachedMasters
      .filter((m) => m.is_active && m.provides_services !== false)
      .map((m) => `<option value="${m.id}">${escapeHtml(m.display_name)}</option>`).join('');
    // Менеджеры: сотрудники с provides_services=false (не техничка) ИЛИ с должностью менеджер/администратор
    const managerPositions = ['менеджер', 'администратор'];
    const managers = cachedMasters.filter((m) => {
      if (!m.is_active) return false;
      const pos = (m.position || '').toLowerCase();
      if (pos === 'техничка') return false;
      if (m.provides_services === false) return true;
      return managerPositions.some((p) => pos.includes(p));
    });
    if (els.bManager) {
      els.bManager.innerHTML = '<option value="">— без менеджера —</option>' +
        managers.map((m) => `<option value="${m.id}">${escapeHtml(m.display_name)}${m.position ? ' · ' + m.position : ''}</option>`).join('');
    }
    renderServiceRows();
  }

  // ===== Услуги записи: строка на позицию =====
  // Раньше был список чекбоксов: 50+ услуг занимали пол-экрана, а цену и
  // скидку приходилось искать в отдельном блоке. Теперь строка на услугу —
  // выбор, длительность, цена, скидка и итог рядом, как в кассовом чеке.
  // rows: [{ service_id, price, discountPct, duration }]
  let svcRows = [];

  const activeServices = () => cachedServices.filter((s) => s.is_active);

  function serviceById(id) {
    return cachedServices.find((s) => s.id === id) || null;
  }

  function rowTotal(row) {
    const price = Number(row.price) || 0;
    const disc = Math.min(100, Math.max(0, Number(row.discountPct) || 0));
    return Math.max(0, Math.round((price - price * disc / 100) * 100) / 100);
  }

  const bookingSubtotal = () => svcRows.reduce((acc, r) => acc + rowTotal(r), 0);
  const bookingDiscountSum = () =>
    svcRows.reduce((acc, r) => acc + Math.max(0, (Number(r.price) || 0) - rowTotal(r)), 0);

  function addServiceRow(serviceId) {
    const svc = serviceId ? serviceById(serviceId) : activeServices()[0];
    if (!svc) return;
    svcRows.push({
      service_id: svc.id,
      price: Number(svc.price),
      discountPct: 0,
      duration: svc.duration_minutes,
    });
    renderServiceRows();
  }

  function renderServiceRows() {
    const grid = document.getElementById('bSvcGrid');
    if (!grid || !cachedServices.length) return;
    // Шапка (первые 7 элементов) остаётся, строки перерисовываем.
    grid.querySelectorAll('.bk-svc-cell').forEach((el) => el.remove());

    const options = activeServices();
    svcRows.forEach((row, idx) => {
      const svc = serviceById(row.service_id);
      const base = svc ? Number(svc.price) : 0;
      const cells = document.createElement('template');
      cells.innerHTML = `
        <div class="bk-svc-cell bk-combo" data-idx="${idx}">
          <button type="button" class="bk-combo-trigger" data-idx="${idx}">
            <span class="bk-combo-value${svc ? '' : ' is-empty'}">${escapeHtml(svc ? svc.name : 'Выберите услугу')}</span>
            <svg class="bk-combo-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M6 9l6 6 6-6" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <div class="bk-combo-panel" hidden>
            <input type="text" class="bk-combo-search" placeholder="Поиск услуги" autocomplete="off" spellcheck="false" />
            <div class="bk-combo-list"></div>
          </div>
        </div>
        <div class="bk-svc-cell"><input class="bk-svc-duration" data-idx="${idx}" type="number" min="5" step="5" value="${row.duration}" aria-label="Длительность, мин" /></div>
        <div class="bk-svc-cell bk-price-wrap">
          ${row.price !== base ? '<span class="bk-price-badge">изм</span>' : ''}
          <input class="bk-svc-price" data-idx="${idx}" type="number" min="0" step="1" value="${row.price}" aria-label="Цена" />
        </div>
        <div class="bk-svc-cell"><input class="bk-svc-disc-pct" data-idx="${idx}" type="number" min="0" max="100" step="0.1" value="${row.discountPct}" aria-label="Скидка %" /></div>
        <div class="bk-svc-cell"><input class="bk-svc-disc-sum" data-idx="${idx}" type="number" min="0" step="1" value="${Math.round((Number(row.price) || 0) - rowTotal(row))}" aria-label="Скидка сумма" /></div>
        <div class="bk-svc-cell"><output class="bk-svc-total-cell">${formatPrice(rowTotal(row))}</output></div>
        <div class="bk-svc-cell">
          <button type="button" class="bk-svc-del" data-idx="${idx}" aria-label="Убрать услугу">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><path d="M5 12h14" stroke-linecap="round"/></svg>
          </button>
        </div>
      `;
      grid.appendChild(cells.content);
    });

    // Итоговая строка по колонкам — как в чеке: суммарная длительность,
    // сумма цен, общий процент скидки, сумма скидок и итог.
    if (svcRows.length) {
      const sumPrice = svcRows.reduce((a, r) => a + (Number(r.price) || 0), 0);
      const sumTotal = bookingSubtotal();
      const sumDisc = Math.round(sumPrice - sumTotal);
      const sumMin = svcRows.reduce((a, r) => a + (Number(r.duration) || 0), 0);
      const pct = sumPrice ? Math.round((sumDisc / sumPrice) * 1000) / 10 : 0;
      const hours = Math.floor(sumMin / 60);
      const durLabel = hours ? `${hours} ч${sumMin % 60 ? ' ' + (sumMin % 60) + ' м' : ''}` : `${sumMin} м`;
      const foot = document.createElement('template');
      foot.innerHTML = `
        <span class="bk-svc-cell bk-svc-sum"></span>
        <span class="bk-svc-cell bk-svc-sum num">${durLabel}</span>
        <span class="bk-svc-cell bk-svc-sum num">${formatPrice(sumPrice)}</span>
        <span class="bk-svc-cell bk-svc-sum num">${pct} %</span>
        <span class="bk-svc-cell bk-svc-sum num">${formatPrice(sumDisc)}</span>
        <span class="bk-svc-cell bk-svc-sum num"><b>${formatPrice(sumTotal)}</b></span>
        <span class="bk-svc-cell"></span>
      `;
      grid.appendChild(foot.content);
    }

    const totalEl = document.getElementById('bTotal');
    if (totalEl) totalEl.textContent = formatPrice(bookingSubtotal());
    checkBookingOverlap();
  }

  // Предупреждаем о наложении сразу, а не после нажатия «Создать»: время
  // окончания зависит от длительности услуг, и на глаз конфликт не виден.
  function checkBookingOverlap() {
    const warn = document.getElementById('bTimeWarn');
    if (!warn) return;
    const startLocal = bookingStartLocal();
    const masterId = els.bMaster?.value;
    const minutes = svcRows.reduce((acc, r) => acc + (Number(r.duration) || 0), 0);
    if (!startLocal || !masterId || !minutes) { warn.hidden = true; return; }

    const start = new Date(startLocal).getTime();
    const end = start + minutes * 60_000;
    const conflict = cachedBookings.find((b) => {
      if (b.master_id !== masterId) return false;
      if (b.status === 'canceled' || b.status === 'no_show') return false;
      if (editingBookingId && b.id === editingBookingId) return false;
      return start < new Date(b.ends_at).getTime() && end > new Date(b.starts_at).getTime();
    });
    const block = cachedTimeBlocks.find((tb) => {
      if (tb.master_id !== masterId) return false;
      return start < new Date(tb.ends_at).getTime() && end > new Date(tb.starts_at).getTime();
    });

    if (conflict) {
      warn.textContent = `Пересекается с записью ${formatTimeRange(conflict.starts_at, conflict.ends_at)}`
        + (conflict.client_name ? ` · ${conflict.client_name}` : '');
      warn.hidden = false;
    } else if (block) {
      warn.textContent = `Время занято мастером: ${formatTimeRange(block.starts_at, block.ends_at)}`;
      warn.hidden = false;
    } else {
      const endD = new Date(end);
      const pad2 = (n) => String(n).padStart(2, '0');
      warn.textContent = `Запись займёт ${minutes} мин · до ${pad2(endD.getHours())}:${pad2(endD.getMinutes())}`;
      warn.hidden = false;
      warn.classList.remove('is-conflict');
      return;
    }
    warn.classList.add('is-conflict');
  }

  els.bDate?.addEventListener('change', checkBookingOverlap);
  els.bTime?.addEventListener('change', checkBookingOverlap);
  els.bMaster?.addEventListener('change', checkBookingOverlap);

  document.getElementById('bSvcAdd')?.addEventListener('click', () => addServiceRow());
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.bk-combo')) closeServiceCombos();
  });

  // ===== Выбор услуги с поиском =====
  // Нативный <select> искать не умеет, а услуг больше полусотни: без поиска
  // нужную позицию приходится прокручивать глазами.
  function renderComboList(wrap, query) {
    const list = wrap?.querySelector('.bk-combo-list');
    if (!list) return;
    const q = (query || '').trim().toLowerCase();
    const matches = activeServices().filter((s) => !q || s.name.toLowerCase().includes(q));
    list.innerHTML = matches.length
      ? matches.map((s) => `
          <button type="button" class="bk-combo-opt" data-service-id="${s.id}">
            <span class="bk-combo-name">${escapeHtml(s.name)}</span>
            <span class="bk-combo-meta">${s.duration_minutes} мин · ${formatPrice(s.price)}</span>
          </button>`).join('')
      : '<div class="bk-combo-empty">Услуги не найдены</div>';
  }

  function closeServiceCombos() {
    document.querySelectorAll('#bSvcGrid .bk-combo-panel').forEach((p) => { p.hidden = true; });
    document.querySelectorAll('#bSvcGrid .bk-combo-trigger').forEach((t) => t.setAttribute('aria-expanded', 'false'));
  }

  document.getElementById('bSvcGrid')?.addEventListener('click', (e) => {
    const trigger = e.target.closest('.bk-combo-trigger');
    if (!trigger) return;
    const wrap = trigger.closest('.bk-combo');
    const panel = wrap.querySelector('.bk-combo-panel');
    const wasOpen = !panel.hidden;
    closeServiceCombos();
    if (wasOpen) return;
    const search = panel.querySelector('.bk-combo-search');
    if (search) search.value = '';
    renderComboList(wrap, '');
    panel.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    search?.focus();
  });

  document.getElementById('bSvcGrid')?.addEventListener('mousedown', (e) => {
    const item = e.target.closest('.bk-combo-opt');
    if (!item) return;
    e.preventDefault();
    const wrap = item.closest('.bk-combo');
    const row = svcRows[Number(wrap.dataset.idx)];
    const svc = serviceById(item.dataset.serviceId);
    if (!row || !svc) return;
    // Смена услуги подставляет её прайс и длительность: держать цену прежней
    // услуги — почти всегда ошибка ввода.
    row.service_id = svc.id;
    row.price = Number(svc.price);
    row.duration = svc.duration_minutes;
    closeServiceCombos();
    renderServiceRows();
  });


  document.getElementById('bSvcGrid')?.addEventListener('input', (e) => {
    const t = e.target;
    if (t.classList.contains('bk-combo-search')) { renderComboList(t.closest('.bk-combo'), t.value); return; }
    const idx = Number(t.dataset.idx);
    const row = svcRows[idx];
    if (!row) return;

    if (t.classList.contains('bk-svc-price')) {
      row.price = Math.max(0, Number(t.value) || 0);
    } else if (t.classList.contains('bk-svc-duration')) {
      row.duration = Math.max(5, Number(t.value) || 5);
    } else if (t.classList.contains('bk-svc-disc-pct')) {
      row.discountPct = Math.min(100, Math.max(0, Number(t.value) || 0));
    } else if (t.classList.contains('bk-svc-disc-sum')) {
      // Сумма скидки — вторая проекция процента: пересчитываем процент,
      // иначе два поля разъедутся и непонятно, какое из них главное.
      const sum = Math.min(Number(t.value) || 0, row.price);
      row.discountPct = row.price ? Math.round((sum / row.price) * 1000) / 10 : 0;
    } else {
      return;
    }
    // Перерисовываем только итоги, чтобы не терять фокус в поле ввода.
    const cells = document.getElementById('bSvcGrid').querySelectorAll('.bk-svc-cell');
    const perRow = 7;
    const totalCell = cells[idx * perRow + 5]?.querySelector('.bk-svc-total-cell');
    if (totalCell) totalCell.textContent = formatPrice(rowTotal(row));
    if (!t.classList.contains('bk-svc-disc-pct')) {
      const pctCell = cells[idx * perRow + 3]?.querySelector('.bk-svc-disc-pct');
      if (pctCell && document.activeElement !== pctCell) pctCell.value = row.discountPct;
    }
    if (!t.classList.contains('bk-svc-disc-sum')) {
      const sumCell = cells[idx * perRow + 4]?.querySelector('.bk-svc-disc-sum');
      if (sumCell && document.activeElement !== sumCell) {
        sumCell.value = Math.round(row.price - rowTotal(row));
      }
    }
    const totalEl = document.getElementById('bTotal');
    if (totalEl) totalEl.textContent = formatPrice(bookingSubtotal());
    // Итоговая строка и предупреждение о наложении зависят от длительности и
    // цен — без пересчёта они показывали прежние значения.
    updateSvcSummary();
    checkBookingOverlap();
  });

  // Обновляет итоговую строку под таблицей, не трогая поля ввода (иначе
  // теряется фокус и каретка при наборе).
  function updateSvcSummary() {
    const grid = document.getElementById('bSvcGrid');
    if (!grid) return;
    const cells = grid.querySelectorAll('.bk-svc-sum');
    if (cells.length < 6) return;
    const sumPrice = svcRows.reduce((a, r) => a + (Number(r.price) || 0), 0);
    const sumTotal = bookingSubtotal();
    const sumDisc = Math.round(sumPrice - sumTotal);
    const sumMin = svcRows.reduce((a, r) => a + (Number(r.duration) || 0), 0);
    const pct = sumPrice ? Math.round((sumDisc / sumPrice) * 1000) / 10 : 0;
    const hours = Math.floor(sumMin / 60);
    cells[1].textContent = hours ? `${hours} ч${sumMin % 60 ? ' ' + (sumMin % 60) + ' м' : ''}` : `${sumMin} м`;
    cells[2].textContent = formatPrice(sumPrice);
    cells[3].textContent = `${pct} %`;
    cells[4].textContent = formatPrice(sumDisc);
    cells[5].innerHTML = `<b>${formatPrice(sumTotal)}</b>`;
  }

  document.getElementById('bSvcGrid')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.bk-svc-del');
    if (!btn) return;
    svcRows.splice(Number(btn.dataset.idx), 1);
    renderServiceRows();
  });

  // ===== Автодополнение клиентов в форме записи =====
  let _clientSuggestItems = [];
  let _clientSuggestIdx = -1;
  let _clientSuggestTimer = null;
  let _clientSelectedLabel = '';

  const clientLabel = (c) => `${c.full_name || c.client_name || ''} · ${c.phone || c.client_phone || ''}`.trim();

  function closeClientSuggest() {
    if (!els.bClientSuggest) return;
    els.bClientSuggest.hidden = true;
    els.bClientSuggest.innerHTML = '';
    els.bClientSearch?.setAttribute('aria-expanded', 'false');
    _clientSuggestItems = [];
    _clientSuggestIdx = -1;
  }

  function renderClientSuggest() {
    if (!els.bClientSuggest) return;
    if (!_clientSuggestItems.length) {
      els.bClientSuggest.innerHTML = '<div class="client-suggest-empty muted">Ничего не найдено — заполните телефон и имя вручную или создайте клиента</div>';
      els.bClientSuggest.hidden = false;
      els.bClientSearch?.setAttribute('aria-expanded', 'true');
      return;
    }
    els.bClientSuggest.innerHTML = _clientSuggestItems.map((c, i) => `
      <button type="button" class="client-suggest-item${i === _clientSuggestIdx ? ' active' : ''}"
              role="option" aria-selected="${i === _clientSuggestIdx}" data-idx="${i}">
        <span class="cs-name">${escapeHtml(c.full_name || 'Без имени')}</span>
        <span class="cs-phone">${escapeHtml(c.phone || '')}</span>
      </button>
    `).join('');
    els.bClientSuggest.hidden = false;
    els.bClientSearch?.setAttribute('aria-expanded', 'true');
  }

  function pickClientSuggest(idx) {
    const c = _clientSuggestItems[idx];
    if (!c) return;
    const phoneEl = document.getElementById('bPhone');
    const nameEl = document.getElementById('bName');
    if (phoneEl) phoneEl.value = c.phone || '';
    if (nameEl) nameEl.value = c.full_name || '';
    _clientSelectedLabel = clientLabel(c);
    if (els.bClientSearch) els.bClientSearch.value = _clientSelectedLabel;
    closeClientSuggest();
  }

  // Телефон в базе хранится как +7XXXXXXXXXX. Пользователь может ввести
  // «8 900…», «+7 900…» или просто «900…» — ищем по последним 10 цифрам,
  // иначе ILIKE по «8900…» не найдёт запись с «+7900…».
  function normalizeClientQuery(q) {
    const digits = q.replace(/\D/g, '');
    const looksLikePhone = digits.length >= 3 && /^[\d\s()+-]+$/.test(q);
    if (!looksLikePhone) return q;
    return digits.length > 10 ? digits.slice(-10) : digits;
  }

  async function searchClientsForBooking(q) {
    const params = new URLSearchParams({ segment: 'all', limit: '10', offset: '0' });
    if (q) params.set('search', normalizeClientQuery(q));
    const r = await apiCall('GET', `/api/clients?${params.toString()}`);
    if (!r.ok || !r.data) return [];
    return (r.data.items || []).filter((c) => !c.is_deleted);
  }

  async function showClientSuggest(q) {
    _clientSuggestItems = await searchClientsForBooking(q);
    _clientSuggestIdx = -1;
    renderClientSuggest();
  }

  // Автодополнение висит сразу на трёх полях: «Клиент», «Имя клиента» и
  // «Телефон клиента». Иначе легко начать печатать в имя или телефон и не
  // понять, почему подсказок нет — поля выглядят одинаково.
  function attachClientAutocomplete(input) {
    if (!input || !els.bClientSuggest) return;
    const host = input.closest('.client-picker') || input.parentElement;
    if (!host) return;
    host.classList.add('client-suggest-host');

    // Выпадашка одна на форму — переносим её под то поле, где сейчас курсор.
    const moveSuggestHere = () => {
      if (els.bClientSuggest.parentElement !== host) host.appendChild(els.bClientSuggest);
    };

    input.addEventListener('focus', () => {
      moveSuggestHere();
      const v = input.value.trim();
      // Если в поле стоит метка уже выбранного клиента («Имя · телефон»),
      // искать по ней бессмысленно — показываем список целиком.
      void showClientSuggest(v && v === _clientSelectedLabel ? '' : v);
    });

    input.addEventListener('input', () => {
      moveSuggestHere();
      const q = input.value.trim();
      clearTimeout(_clientSuggestTimer);
      _clientSuggestTimer = setTimeout(() => { void showClientSuggest(q); }, 250);
    });

    input.addEventListener('keydown', (e) => {
      if (els.bClientSuggest.hidden) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!_clientSuggestItems.length) return;
        const delta = e.key === 'ArrowDown' ? 1 : -1;
        _clientSuggestIdx = (_clientSuggestIdx + delta + _clientSuggestItems.length) % _clientSuggestItems.length;
        renderClientSuggest();
      } else if (e.key === 'Enter') {
        if (_clientSuggestIdx >= 0) { e.preventDefault(); pickClientSuggest(_clientSuggestIdx); }
      } else if (e.key === 'Escape') {
        closeClientSuggest();
      }
    });

    input.addEventListener('blur', () => setTimeout(closeClientSuggest, 150));
  }

  [els.bClientSearch, document.getElementById('bName'), document.getElementById('bPhone')]
    .forEach(attachClientAutocomplete);

  els.bClientSuggest?.addEventListener('mousedown', (e) => {
    const btn = e.target.closest('.client-suggest-item');
    if (!btn) return;
    e.preventDefault();
    pickClientSuggest(Number(btn.dataset.idx));
  });

  // «Новый клиент» прямо из журнала: открываем стандартную карточку клиента,
  // а после сохранения подставляем его в форму записи.
  let _clientModalFromBooking = false;
  els.bClientNew?.addEventListener('click', () => {
    closeClientSuggest();
    _clientModalFromBooking = true;
    openClientModal(null);
    const typed = els.bClientSearch?.value.trim() || '';
    setTimeout(() => {
      if (!typed) return;
      // Цифры → телефон, иначе имя.
      const isPhone = /^[\d+][\d\s()+-]*$/.test(typed);
      if (isPhone && els.clPhone) els.clPhone.value = typed;
      else if (els.clFullName) els.clFullName.value = typed;
    }, 60);
  });

  function fillBookingClientAfterCreate(client) {
    if (!_clientModalFromBooking) return;
    _clientModalFromBooking = false;
    const phoneEl = document.getElementById('bPhone');
    const nameEl = document.getElementById('bName');
    if (phoneEl) phoneEl.value = client.phone || '';
    if (nameEl) nameEl.value = client.full_name || '';
    _clientSelectedLabel = clientLabel(client);
    if (els.bClientSearch) els.bClientSearch.value = _clientSelectedLabel;
  }

  els.journalDate?.addEventListener('change', () => {
    miniCalAnchor = (els.journalDate.value || todayLocalISO()).slice(0, 7);
    void loadBookings();
  });
  els.journalPrevDay?.addEventListener('click', () => shiftJournalDate(-1));
  els.journalNextDay?.addEventListener('click', () => shiftJournalDate(1));
  document.getElementById('exportBookingsCsv')?.addEventListener('click', exportBookingsCsv);
  els.financeRefresh?.addEventListener('click', () => renderFinance());
  els.addSaleBtn?.addEventListener('click', () => toast('Модуль «Продажи» в разработке (Phase 1).'));

  // Booking view modal listeners
  els.bkModalClose?.addEventListener('click', closeBookingModal);
  els.bkModalClose2?.addEventListener('click', closeBookingModal);
  els.bkModalBackdrop?.addEventListener('click', closeBookingModal);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !els.bkModal?.hidden) closeBookingModal(); });
  els.bkModalRepeat?.addEventListener('click', () => { if (_bkModalCurrent) repeatBooking(_bkModalCurrent); });
  document.getElementById('bkModalEdit')?.addEventListener('click', () => {
    if (_bkModalCurrent) openEditBooking(_bkModalCurrent);
  });

  // ===== История изменений записи =====
  const AUDIT_ACTION_RU = {
    created: 'создана', updated: 'изменена', canceled: 'отменена',
    completed: 'завершена', no_show: 'клиент не пришёл',
  };
  const AUDIT_FIELD_RU = {
    notes: 'примечание', status: 'статус', master_id: 'сотрудник',
    starts_at: 'начало', ends_at: 'окончание', client_phone: 'телефон',
    client_name: 'имя клиента', manager_id: 'менеджер', services: 'услуги',
    total_price: 'стоимость', discount_pct: 'скидка %', discount_amount: 'скидка ₽',
  };

  function formatAuditValue(field, v) {
    if (v === null || v === undefined || v === '') return '—';
    if (field === 'starts_at' || field === 'ends_at') {
      const d = new Date(v);
      return `${d.toLocaleDateString('ru-RU')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }
    if (field === 'master_id' || field === 'manager_id') {
      return cachedMasters.find((m) => m.id === v)?.display_name || String(v).slice(0, 8);
    }
    if (field === 'total_price' || field === 'discount_amount') return formatPrice(Number(v));
    return String(v);
  }

  document.getElementById('bkModalHistory')?.addEventListener('click', async () => {
    if (!_bkModalCurrent) return;
    const body = document.getElementById('bkModalBody');
    if (!body) return;
    body.innerHTML = '<div class="muted">Загрузка истории…</div>';
    const r = await apiCall('GET', `/api/bookings/${_bkModalCurrent.id}/history`, null);
    if (!r.ok) { body.innerHTML = '<div class="muted">Не удалось загрузить историю</div>'; return; }
    const items = r.data?.items || [];
    if (!items.length) {
      body.innerHTML = '<div class="muted">Запись ещё не редактировали</div>';
      return;
    }
    body.innerHTML = `<div class="audit-list">${items.map((it) => {
      const when = new Date(it.created_at);
      const changes = Object.entries(it.changes || {}).map(([field, ch]) => `
        <li><span class="audit-field">${escapeHtml(AUDIT_FIELD_RU[field] || field)}</span>:
          <s>${escapeHtml(formatAuditValue(field, ch.from))}</s> →
          <b>${escapeHtml(formatAuditValue(field, ch.to))}</b></li>
      `).join('');
      return `
        <div class="audit-item">
          <div class="audit-head">
            <b>${escapeHtml(it.actor_name || 'Система')}</b>
            <span class="muted">${escapeHtml(it.actor_role || '')}</span>
            <span class="audit-time">${when.toLocaleDateString('ru-RU')} ${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}</span>
          </div>
          <div class="audit-action">${escapeHtml(AUDIT_ACTION_RU[it.action] || it.action)}</div>
          ${changes ? `<ul class="audit-changes">${changes}</ul>` : ''}
        </div>`;
    }).join('')}</div>`;
  });

  document.getElementById('bkModalConfirm')?.addEventListener('click', async () => {
    if (!_bkModalCurrent) return;
    const btn = document.getElementById('bkModalConfirm');
    btn.disabled = true; btn.textContent = 'Подтверждаем…';
    const { ok } = await apiCall('PATCH', `/api/bookings/${_bkModalCurrent.id}`, { status: 'confirmed' });
    btn.disabled = false; btn.textContent = 'Подтвердить';
    if (ok) { closeBookingModal(); void loadBookings(); }
  });

  document.getElementById('bkModalCancel2')?.addEventListener('click', async () => {
    if (!_bkModalCurrent) return;
    if (!confirm('Отменить эту запись?')) return;
    const { ok } = await apiCall('POST', `/api/bookings/${_bkModalCurrent.id}/cancel`, {});
    if (ok) { closeBookingModal(); void loadBookings(); }
  });

  // «Не пришёл» — статус no_show (клиент не явился). В расчёт зарплаты/выручки не попадает.
  document.getElementById('bkModalNoShow')?.addEventListener('click', async () => {
    if (!_bkModalCurrent) return;
    if (!confirm('Отметить, что клиент не пришёл? Начислений и оплаты по записи не будет.')) return;
    const { ok } = await apiCall('POST', `/api/bookings/${_bkModalCurrent.id}/cancel`, { no_show: true });
    if (ok) { toast('Отмечено: клиент не пришёл'); closeBookingModal(); void loadBookings(); }
    else toast('Не удалось отметить');
  });

  // ===== Пополнение лицевого счёта клиента прямо из записи =====
  let _bkTopupClientId = null;
  function closeBkTopup() {
    const bd = document.getElementById('bkTopupBackdrop');
    const md = document.getElementById('bkTopupModal');
    if (bd) bd.hidden = true;
    if (md) md.hidden = true;
    _bkTopupClientId = null;
  }
  document.getElementById('bkModalTopup')?.addEventListener('click', async () => {
    const b = _bkModalCurrent;
    if (!b || !b.client_id) { toast('Запись не привязана к клиенту'); return; }
    _bkTopupClientId = b.client_id;
    const nameEl = document.getElementById('bkTopupClient');
    if (nameEl) nameEl.textContent = 'Клиент: ' + (b.client_name || b.client_phone || '—');
    const amtEl = document.getElementById('bkTopupAmount');
    if (amtEl) amtEl.value = '';
    const noteEl = document.getElementById('bkTopupNote');
    if (noteEl) noteEl.value = '';
    const errEl = document.getElementById('bkTopupError');
    if (errEl) errEl.hidden = true;
    // Список счетов (нал/безнал) из финансов
    const sel = document.getElementById('bkTopupAccount');
    if (sel) {
      const ra = await apiCall('GET', '/api/finance/accounts');
      const accs = ra.ok ? (ra.data?.items || []) : [];
      sel.innerHTML = '<option value="">— счёт (нал/безнал) —</option>'
        + accs.filter((a) => a.is_active !== false)
            .map((a) => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)} (${a.type === 'cash' ? 'нал' : 'безнал'})</option>`).join('');
    }
    const bd = document.getElementById('bkTopupBackdrop');
    const md = document.getElementById('bkTopupModal');
    if (bd) bd.hidden = false;
    if (md) md.hidden = false;
    document.getElementById('bkTopupAmount')?.focus();
  });
  document.getElementById('bkTopupClose')?.addEventListener('click', closeBkTopup);
  document.getElementById('bkTopupCancel')?.addEventListener('click', closeBkTopup);
  document.getElementById('bkTopupBackdrop')?.addEventListener('click', closeBkTopup);
  document.getElementById('bkTopupForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = _bkTopupClientId;
    if (!id) return;
    const amount = Number(document.getElementById('bkTopupAmount')?.value);
    const account_id = document.getElementById('bkTopupAccount')?.value || null;
    const note = document.getElementById('bkTopupNote')?.value?.trim() || undefined;
    const errEl = document.getElementById('bkTopupError');
    const btn = document.getElementById('bkTopupSubmit');
    if (!amount || amount <= 0) {
      if (errEl) { errEl.textContent = 'Введите сумму пополнения'; errEl.hidden = false; }
      return;
    }
    if (btn) { btn.disabled = true; btn.textContent = 'Пополняем…'; }
    const r = await apiCall('POST', `/api/clients/${id}/balance/topup`, { amount, account_id, note });
    if (btn) { btn.disabled = false; btn.textContent = 'Пополнить'; }
    if (!r.ok) {
      if (errEl) { errEl.textContent = 'Ошибка: ' + (r.data?.error || r.status); errEl.hidden = false; }
      return;
    }
    toast('Счёт пополнен на ' + formatPrice(amount));
    closeBkTopup();
    // Обновим кэш клиента, если он загружен
    const c = clientsState?.items?.find?.((x) => x.id === id);
    if (c && r.data?.balance != null) c.balance = r.data.balance;
  });

  els.journalPeriodBtns?.forEach((btn) => {
    btn.addEventListener('click', () => {
      const p = btn.dataset.period;
      if (p === 'today') setJournalPeriod('day', todayLocalISO());
      else if (p === 'tomorrow') setJournalPeriod('day', addDaysISO(todayLocalISO(), 1));
      else if (p === 'week') setJournalPeriod('week');
      else if (p === 'month') setJournalPeriod('month');
    });
  });

  // Filters in list mode
  function onFilterChange() {
    journalFilters.master_id = els.filterMaster?.value || '';
    journalFilters.status = els.filterStatus?.value || '';
    journalFilters.source = els.filterSource?.value || '';
    journalFilters.client = els.filterClient?.value.trim() || '';
    journalFilters.anon = !!els.filterAnon?.checked;
    renderJournal();
  }
  els.filterMaster?.addEventListener('change', onFilterChange);
  els.filterStatus?.addEventListener('change', onFilterChange);
  els.filterSource?.addEventListener('change', onFilterChange);
  els.filterAnon?.addEventListener('change', onFilterChange);
  let _filterClientTimer = null;
  els.filterClient?.addEventListener('input', () => {
    clearTimeout(_filterClientTimer);
    _filterClientTimer = setTimeout(onFilterChange, 250);
  });
  els.filterReset?.addEventListener('click', () => {
    journalFilters.master_id = '';
    journalFilters.status = '';
    journalFilters.source = '';
    journalFilters.client = '';
    journalFilters.anon = false;
    if (els.filterMaster) els.filterMaster.value = '';
    if (els.filterStatus) els.filterStatus.value = '';
    if (els.filterSource) els.filterSource.value = '';
    if (els.filterClient) els.filterClient.value = '';
    if (els.filterAnon) els.filterAnon.checked = false;
    renderJournal();
  });

  els.calToggleBtns?.forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode || 'calendar';
      // 'masters' пока не реализуем отдельно — показываем как calendar (мастера в колонках)
      journalMode = mode === 'masters' ? 'calendar' : mode;
      localStorage.setItem('journalMode', journalMode);
      renderJournal();
      // подсветить нажатую (включая masters)
      els.calToggleBtns.forEach((b) => b.classList.toggle('active', b === btn));
    });
  });

  els.addBookingToggle?.addEventListener('click', () => {
    if (isAddBookingOpen()) { closeAddBookingModal(); return; }
    resetBookingForm();
    openAddBookingModal();
    setTimeout(() => els.bClientSearch?.focus(), 50);
  });
  els.addBookingCancel?.addEventListener('click', () => {
    closeAddBookingModal();
    resetBookingForm();
  });
  els.addBookingClose?.addEventListener('click', () => {
    closeAddBookingModal();
    resetBookingForm();
  });
  els.addBookingBackdrop?.addEventListener('click', () => {
    closeAddBookingModal();
    resetBookingForm();
  });
  document.addEventListener('keydown', (e) => {
    // Escape закрывает модалку, но только если подсказки клиентов уже скрыты —
    // иначе первый Escape должен закрывать именно выпадающий список.
    if (e.key !== 'Escape' || !isAddBookingOpen()) return;
    if (els.bClientSuggest && !els.bClientSuggest.hidden) return;
    closeAddBookingModal();
  });

  async function submitTimeBlock() {
    const master_id = document.getElementById('bMaster')?.value || '';
    const startLocal = bookingStartLocal();
    const minutes = Number(document.getElementById('bBlockDuration')?.value || 60);
    const reason = document.getElementById('bBlockReason')?.value.trim() || '';
    if (!master_id || !startLocal) {
      toast('Заполни сотрудника и время начала');
      return;
    }
    const startDate = new Date(startLocal);
    const endDate = new Date(startDate.getTime() + minutes * 60_000);
    const pad = (n) => String(n).padStart(2, '0');
    const endLocal = `${dateToISO(endDate)}T${pad(endDate.getHours())}:${pad(endDate.getMinutes())}`;

    const tz = '+03:00'; // как в создании записи — COMPANY_TZ_OFFSET booking-service
    const body = {
      master_id,
      starts_at: `${startLocal}:00${tz}`,
      ends_at: `${endLocal}:00${tz}`,
      color: selectedBlockColor,
    };
    if (reason) body.reason = reason;
    const { ok, data, status } = await apiCall('POST', '/api/bookings/blocks', body);
    if (!ok) {
      toast(`Ошибка: ${data?.error || status}`);
      return;
    }
    toast('Время занято — записаться на него нельзя');
    resetBookingForm();
    closeAddBookingModal();
    if (!els.journalDate.value) els.journalDate.value = todayLocalISO();
    await loadBookings();
  }

  function resetBookingForm() {
    els.addBookingForm.reset();
    // Иначе следующая «Новая запись» молча перезапишет ту, что правили до этого.
    editingBookingId = null;
    const tabs = document.getElementById('addBookingTabs');
    if (tabs) tabs.hidden = false;
    const title = document.getElementById('addBookingTitle');
    if (title) title.textContent = 'Новая запись';
    const submit = document.getElementById('addBookingSubmit');
    if (submit) submit.textContent = 'Создать';
    setAddBookingMode('booking');
    if (els.bClientSearch) els.bClientSearch.value = '';
    _clientSelectedLabel = '';
    closeClientSuggest();
    svcRows = [];
    renderServiceRows();
    selectedBookingColor = null;
    renderBookingColors();
  }
  // Дата и время — раздельные поля (как в референсе), а сервер ждёт один
  // локальный момент вида «2026-04-25T11:00».
  function bookingStartLocal() {
    const d = els.bDate?.value || '';
    const t = els.bTime?.value || '';
    return d && t ? `${d}T${t}` : '';
  }

  els.addBookingForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (addBookingMode === 'block') { await submitTimeBlock(); return; }
    const fd = new FormData(els.addBookingForm);
    const master_id = String(fd.get('master_id') || '');
    const startsLocal = bookingStartLocal();  // "2026-04-25T11:00"
    const client_phone = String(fd.get('client_phone') || '').trim();
    const client_name = String(fd.get('client_name') || '').trim();
    const notes = String(fd.get('notes') || '').trim();
    const service_ids = svcRows.map((r) => r.service_id);
    if (!master_id || !startsLocal || !client_phone || service_ids.length === 0) {
      toast('Заполни сотрудника, время, телефон и хотя бы одну услугу');
      return;
    }
    const manager_id = String(fd.get('manager_id') || '').trim() || null;
    const tz = '+03:00'; // соответствует COMPANY_TZ_OFFSET в booking-service
    const starts_at = `${startsLocal}:00${tz}`;
    const body = { master_id, service_ids, starts_at, client_phone };
    // Цена позиции = цена из строки; на сервер уходит только то, что реально
    // отличается от прайса, иначе запись навсегда зафиксирует текущие цены.
    const overrides = {};
    svcRows.forEach((r) => {
      const svc = cachedServices.find((s) => s.id === r.service_id);
      if (svc && Number(r.price) !== Number(svc.price)) overrides[r.service_id] = Number(r.price);
    });
    if (Object.keys(overrides).length) body.price_overrides = overrides;
    // Длительность тоже уходит на сервер: без неё запись занимала прайсовое
    // время, и «10 минут» превращались в час — с ложным конфликтом слота.
    const durations = {};
    svcRows.forEach((r) => {
      const svc = cachedServices.find((s) => s.id === r.service_id);
      if (svc && Number(r.duration) !== Number(svc.duration_minutes)) {
        durations[r.service_id] = Number(r.duration);
      }
    });
    if (Object.keys(durations).length) body.duration_overrides = durations;
    // Скидки заданы построчно — на запись уходит их сумма: в bookings скидка
    // хранится одним полем, и именно её вычитают выручка и зарплата.
    const discountAmount = Math.round(bookingDiscountSum());
    if (discountAmount > 0) body.discount_amount = discountAmount;
    // При правке шлём и null — так снимается ранее выбранный цвет.
    if (selectedBookingColor || editingBookingId) body.color = selectedBookingColor;
    if (client_name) body.client_name = client_name;
    if (notes) body.notes = notes;
    if (manager_id) body.manager_id = manager_id;
    const { ok, data, status } = editingBookingId
      ? await apiCall('PATCH', `/api/bookings/${editingBookingId}`, body)
      : await apiCall('POST', '/api/bookings', body);
    if (!ok) {
      toast(`Ошибка: ${data?.error || status}${data?.code ? ' · ' + data.code : ''}`);
      return;
    }
    toast(editingBookingId ? 'Запись изменена' : 'Запись создана');
    resetBookingForm();
    closeAddBookingModal();
    if (!els.journalDate.value) els.journalDate.value = todayLocalISO();
    await loadBookings();
  });

  // ===== Schedule (master work hours) =====
  function addDaysISO(dateStr, days) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function formatDateShort(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    return `${day}.${month} (${WEEKDAYS_SHORT[d.getDay()]})`;
  }

  function isWeekend(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    return d.getDay() === 0 || d.getDay() === 6;
  }

  // ===== Schedule (DIKIDI-style horizontal grid) =====
  // Структура: scheduleByMaster: Map<masterId, Map<work_date, {start,end,off,dirty,saved}>>
  let scheduleByMaster = new Map();

  function getMonthRange(monthAnchor) {
    const [y, m] = monthAnchor.split('-').map(Number);
    const from = `${y}-${String(m).padStart(2, '0')}-01`;
    const last = new Date(y, m, 0).getDate();
    const to = `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
    return { from, to, y, m, days: last };
  }

  async function initScheduleView() {
    if (!cachedMasters.length) await loadMasters();
    if (cachedMasters.length === 0) {
      els.schGrid.innerHTML = '<div class="empty">Сначала добавь хотя бы одного сотрудника в разделе «Сотрудники».</div>';
      return;
    }
    if (!scheduleMonth) scheduleMonth = todayLocalISO().slice(0, 7);
    updateScheduleMonthLabels();
    if (els.schMastersCount) els.schMastersCount.textContent = String(cachedMasters.filter((m) => m.is_active).length);
    await loadAllSchedules();
  }

  function updateScheduleMonthLabels() {
    if (!els.schMonthLabel) return;
    const [y, m] = scheduleMonth.split('-').map(Number);
    els.schMonthLabel.textContent = `${MONTHS_RU[m - 1]} ${y}`;
    const prevM = m === 1 ? 12 : m - 1;
    const nextM = m === 12 ? 1 : m + 1;
    if (els.schPrevMonthLabel) els.schPrevMonthLabel.textContent = MONTHS_RU[prevM - 1];
    if (els.schNextMonthLabel) els.schNextMonthLabel.textContent = MONTHS_RU[nextM - 1];
  }

  async function loadAllSchedules() {
    const masters = cachedMasters.filter((m) => m.is_active);
    const { from, to } = getMonthRange(scheduleMonth);
    scheduleByMaster = new Map();
    for (const m of masters) {
      const { ok, data } = await call(
        'GET',
        `/api/salons/schedule/${m.id}?from=${from}&to=${to}`,
        null,
        store.access,
      );
      const dayMap = new Map();
      if (ok && data?.items) {
        data.items.forEach((it) => {
          dayMap.set(it.work_date, {
            work_date: it.work_date,
            start_time: it.start_time ? it.start_time.slice(0, 5) : '',
            end_time: it.end_time ? it.end_time.slice(0, 5) : '',
            is_day_off: !!it.is_day_off,
            saved: true,
            dirty: false,
          });
        });
      }
      scheduleByMaster.set(m.id, dayMap);
    }
    renderSchedule();
  }

  function renderSchedule() {
    const masters = cachedMasters.filter((m) => m.is_active);
    if (masters.length === 0) {
      els.schGrid.innerHTML = '<div class="empty">Нет активных сотрудников.</div>';
      return;
    }
    const { y, m, days } = getMonthRange(scheduleMonth);
    const today = todayLocalISO();

    const dayCellW = 76;
    const masterCellW = 64;

    const grid = document.createElement('div');
    grid.className = 'schedule-hgrid';
    grid.style.gridTemplateColumns = `${masterCellW}px repeat(${days}, ${dayCellW}px)`;
    grid.style.gridTemplateRows = `56px repeat(${masters.length}, 64px)`;

    // Top-left corner
    const corner = document.createElement('div');
    corner.className = 'sch-corner-cell';
    corner.style.gridRow = '1'; corner.style.gridColumn = '1';
    corner.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 9h17M8 3.5v3M16 3.5v3"/></svg>`;
    grid.appendChild(corner);

    // Day headers
    for (let d = 1; d <= days; d++) {
      const dt = new Date(y, m - 1, d);
      const dow = dt.getDay();
      const isWk = dow === 0 || dow === 6;
      const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const isToday = iso === today;
      const head = document.createElement('div');
      head.className = `sch-day-head ${isWk ? 'weekend' : ''} ${isToday ? 'today' : ''}`;
      head.style.gridRow = '1';
      head.style.gridColumn = String(d + 1);
      head.innerHTML = `<div class="sch-day-num">${d}</div><div class="sch-day-dow">${WEEKDAYS_RU[dow].toLowerCase()}</div>`;
      grid.appendChild(head);
    }

    // Master rows
    masters.forEach((mst, rowIdx) => {
      // master cell (left col)
      const mc = document.createElement('div');
      mc.className = 'sch-master-cell';
      mc.style.gridRow = String(rowIdx + 2);
      mc.style.gridColumn = '1';
      const initials = (mst.display_name || '?').split(' ').map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
      mc.innerHTML = mst.avatar_url
        ? `<div class="sch-master-avatar" style="background-image:url('${mst.avatar_url}');background-size:cover;background-position:center"></div>`
        : `<div class="sch-master-avatar" style="background:${stringToColor(mst.id)}">${escapeHtml(initials || '?')}</div>`;
      mc.title = mst.display_name || '';
      grid.appendChild(mc);

      const dayMap = scheduleByMaster.get(mst.id) || new Map();
      for (let d = 1; d <= days; d++) {
        const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const dt = new Date(y, m - 1, d);
        const dow = dt.getDay();
        const isWk = dow === 0 || dow === 6;
        const isToday = iso === today;
        const it = dayMap.get(iso);

        const cell = document.createElement('div');
        cell.dataset.iso = iso;
        cell.dataset.masterId = mst.id;
        const cls = ['sch-cell'];
        if (isWk) cls.push('weekend');
        if (isToday) cls.push('today');
        if (it && it.dirty) cls.push('dirty');
        if (it && it.is_day_off) cls.push('is-off');
        if (!it || (!it.is_day_off && !it.start_time)) cls.push('empty');
        cell.className = cls.join(' ');
        cell.style.gridRow = String(rowIdx + 2);
        cell.style.gridColumn = String(d + 1);

        if (it && it.is_day_off) {
          // У DIKIDI выходная ячейка пустая, без текста — только подсветка через .is-off + .weekend
          cell.innerHTML = '';
        } else if (it && it.start_time && it.end_time) {
          cell.innerHTML = `<div>${escapeHtml(it.start_time)}</div><div>${escapeHtml(it.end_time)}</div>`;
        } else {
          cell.innerHTML = '';
        }

        cell.addEventListener('click', (e) => {
          if (e.shiftKey) {
            // toggle day-off
            const cur = scheduleByMaster.get(mst.id) || new Map();
            const exist = cur.get(iso) || { work_date: iso, start_time: '', end_time: '', is_day_off: false, saved: false, dirty: false };
            exist.is_day_off = !exist.is_day_off;
            if (exist.is_day_off) { exist.start_time = ''; exist.end_time = ''; }
            exist.dirty = true;
            cur.set(iso, exist);
            scheduleByMaster.set(mst.id, cur);
            renderSchedule();
            return;
          }
          const startStr = prompt('Время начала (например 10:00):', (it && it.start_time) || '10:00');
          if (startStr == null) return;
          const endStr = prompt('Время конца (например 20:00):', (it && it.end_time) || '20:00');
          if (endStr == null) return;
          if (!/^\d{1,2}:\d{2}$/.test(startStr) || !/^\d{1,2}:\d{2}$/.test(endStr)) {
            toast('Формат времени HH:MM');
            return;
          }
          const cur = scheduleByMaster.get(mst.id) || new Map();
          cur.set(iso, {
            work_date: iso,
            start_time: startStr,
            end_time: endStr,
            is_day_off: false,
            saved: it ? it.saved : false,
            dirty: true,
          });
          scheduleByMaster.set(mst.id, cur);
          renderSchedule();
        });

        grid.appendChild(cell);
      }
    });

    els.schGrid.innerHTML = '';
    els.schGrid.appendChild(grid);
    updateSaveBtn();
    renderSchedulePreview();
  }

  // DIKIDI-style mini-preview: следующие 6 дней × все мастера
  function renderSchedulePreview() {
    const root = document.getElementById('schPreview');
    if (!root) return;
    const masters = cachedMasters.filter((m) => m.is_active).slice(0, 6);
    if (masters.length === 0) { root.innerHTML = ''; return; }

    // Берём ближайшие 6 дней начиная с завтра
    const today = new Date(todayLocalISO() + 'T00:00:00');
    const days = [];
    for (let i = 1; i <= 6; i++) {
      const d = new Date(today); d.setDate(d.getDate() + i);
      days.push({
        iso: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
        num: d.getDate(),
        dow: d.getDay(),
        weekend: d.getDay() === 0 || d.getDay() === 6,
      });
    }

    let html = '<div class="sch-preview-grid">';
    // header row
    html += '<div class="spc-corner"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 9h17M8 3.5v3M16 3.5v3"/></svg></div>';
    days.forEach((d) => {
      html += `<div class="spc${d.weekend ? ' weekend' : ''}"><div class="spc-num">${d.num}</div><div class="spc-dow">${WEEKDAYS_RU[d.dow].toLowerCase()}</div></div>`;
    });
    // master rows
    masters.forEach((m) => {
      const initials = (m.display_name || '?').split(' ').map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
      html += `<div class="spm"><div class="spm-avatar" style="background:${stringToColor(m.id)}">${escapeHtml(initials || '?')}</div></div>`;
      const dayMap = scheduleByMaster.get(m.id) || new Map();
      days.forEach((d) => {
        const it = dayMap.get(d.iso);
        const cls = ['spcell'];
        if (d.weekend) cls.push('weekend');
        if (it && it.is_day_off) cls.push('is-off');
        if (!it || (!it.is_day_off && !it.start_time)) cls.push('empty');
        let inner = '';
        if (it && !it.is_day_off && it.start_time && it.end_time) {
          inner = `<div>${escapeHtml(it.start_time)}</div><div>${escapeHtml(it.end_time)}</div>`;
        }
        html += `<div class="${cls.join(' ')}">${inner}</div>`;
      });
    });
    html += '</div>';
    root.innerHTML = html;
  }

  function updateSaveBtn() {
    if (!els.schSave) return;
    let dirtyCount = 0;
    scheduleByMaster.forEach((dayMap) => {
      dayMap.forEach((it) => { if (it.dirty) dirtyCount++; });
    });
    els.schSave.textContent = dirtyCount > 0 ? `Сохранить (${dirtyCount})` : 'Сохранить';
    els.schSave.disabled = dirtyCount === 0;
  }

  function applyTemplate() {
    const { y, m, days } = getMonthRange(scheduleMonth);
    let touched = 0;
    cachedMasters.filter((x) => x.is_active).forEach((mst) => {
      const dayMap = scheduleByMaster.get(mst.id) || new Map();
      for (let d = 1; d <= days; d++) {
        const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const it = dayMap.get(iso);
        if (it && (it.is_day_off || it.start_time)) continue;
        dayMap.set(iso, { work_date: iso, start_time: '10:00', end_time: '20:00', is_day_off: false, saved: false, dirty: true });
        touched++;
      }
      scheduleByMaster.set(mst.id, dayMap);
    });
    if (touched === 0) {
      toast('Нет пустых дней для шаблона.');
      return;
    }
    renderSchedule();
  }

  async function saveSchedule() {
    let savedAny = false;
    for (const [masterId, dayMap] of scheduleByMaster.entries()) {
      const items = [];
      dayMap.forEach((it) => {
        if (!it.dirty) return;
        const obj = { work_date: it.work_date, is_day_off: it.is_day_off };
        if (!it.is_day_off) {
          obj.start_time = it.start_time;
          obj.end_time = it.end_time;
        }
        if (obj.is_day_off || (obj.start_time && obj.end_time)) items.push(obj);
      });
      if (items.length === 0) continue;
      const { ok, data, status } = await apiCall('PUT', `/api/salons/schedule/${masterId}`, { items });
      if (!ok) {
        toast(`Ошибка для сотрудника ${masterId}: ${data?.error || status}`);
        continue;
      }
      savedAny = true;
    }
    if (savedAny) await loadAllSchedules();
  }

  els.schApplyTemplate?.addEventListener('click', applyTemplate);
  els.schSave?.addEventListener('click', saveSchedule);
  els.schPrevMonth?.addEventListener('click', () => {
    const [y, m] = scheduleMonth.split('-').map(Number);
    const nm = m === 1 ? 12 : m - 1;
    const ny = m === 1 ? y - 1 : y;
    scheduleMonth = `${ny}-${String(nm).padStart(2, '0')}`;
    updateScheduleMonthLabels();
    void loadAllSchedules();
  });
  els.schNextMonth?.addEventListener('click', () => {
    const [y, m] = scheduleMonth.split('-').map(Number);
    const nm = m === 12 ? 1 : m + 1;
    const ny = m === 12 ? y + 1 : y;
    scheduleMonth = `${ny}-${String(nm).padStart(2, '0')}`;
    updateScheduleMonthLabels();
    void loadAllSchedules();
  });
  els.schAddMaster?.addEventListener('click', () => toast('Добавь сотрудника в разделе «Сотрудники».'));

  // ===== Journal master filter (DIKIDI-style dropdown с группировкой) =====
  function jrnGroupMasters() {
    const groups = new Map();
    cachedMasters.filter((m) => m.is_active && m.provides_services !== false).forEach((m) => {
      const role = (m.specialization || '').trim() || 'Другие';
      if (!groups.has(role)) groups.set(role, []);
      groups.get(role).push(m);
    });
    return groups;
  }
  function jrnRenderMasterFilter() {
    const root = document.getElementById('jrnMfGroups');
    const allCb = document.getElementById('jrnMfAll');
    const allCount = document.getElementById('jrnMfAllCount');
    const trigger = document.getElementById('jrnMasterFilterLabel');
    const triggerCount = document.getElementById('jrnMastersCount');
    if (!root) return;
    const groups = jrnGroupMasters();
    const total = cachedMasters.filter((m) => m.is_active && m.provides_services !== false).length;
    const selectedCount = jrnSelectedMasters ? jrnSelectedMasters.size : total;

    if (allCb) allCb.checked = !jrnSelectedMasters || jrnSelectedMasters.size === total;
    if (allCount) allCount.textContent = String(total);

    if (selectedCount === total) {
      if (trigger) trigger.textContent = 'Все сотрудники';
      if (triggerCount) { triggerCount.textContent = String(total); triggerCount.hidden = false; }
    } else if (selectedCount === 1) {
      const id = [...jrnSelectedMasters][0];
      const m = cachedMasters.find((x) => x.id === id);
      if (trigger) trigger.textContent = m ? (m.display_name || '—') : '—';
      if (triggerCount) triggerCount.hidden = true;
    } else {
      if (trigger) trigger.textContent = 'Выбрано';
      if (triggerCount) { triggerCount.textContent = `${selectedCount} из ${total}`; triggerCount.hidden = false; }
    }

    let html = '';
    groups.forEach((arr, role) => {
      const selectedInGroup = arr.filter((m) => !jrnSelectedMasters || jrnSelectedMasters.has(m.id)).length;
      const allChecked = selectedInGroup === arr.length;
      html += `
        <div class="sch-mf-row sch-mf-group" data-group="${escapeHtml(role)}">
          <span class="sch-mf-name">${escapeHtml(role)}</span>
          <span class="sch-mf-count">${arr.length}</span>
          <input type="checkbox" data-jgrp-cb="${escapeHtml(role)}" ${allChecked ? 'checked' : ''} />
        </div>
      `;
      arr.forEach((m) => {
        const initials = (m.display_name || '?').split(' ').map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
        html += `
          <div class="sch-mf-row sch-mf-master" data-master-id="${m.id}">
            <div class="sch-mf-avatar" style="background:${stringToColor(m.id)}">${escapeHtml(initials || '?')}</div>
            <span class="sch-mf-name">${escapeHtml(m.display_name || '—')}</span>
            <span></span>
            <input type="checkbox" data-jmaster-cb="${m.id}" ${!jrnSelectedMasters || jrnSelectedMasters.has(m.id) ? 'checked' : ''} />
          </div>
        `;
      });
    });
    root.innerHTML = html;

    root.querySelectorAll('[data-jmaster-cb]').forEach((cb) => {
      cb.addEventListener('change', () => {
        const id = cb.dataset.jmasterCb;
        const all = cachedMasters.filter((m) => m.is_active && m.provides_services !== false);
        if (jrnSelectedMasters === null) jrnSelectedMasters = new Set(all.map((m) => m.id));
        if (cb.checked) jrnSelectedMasters.add(id); else jrnSelectedMasters.delete(id);
        if (jrnSelectedMasters.size === all.length) jrnSelectedMasters = null;
        jrnRenderMasterFilter();
        renderJournal();
      });
    });
    root.querySelectorAll('[data-jgrp-cb]').forEach((cb) => {
      cb.addEventListener('change', () => {
        const role = cb.dataset.jgrpCb;
        const groupMasters = (jrnGroupMasters().get(role) || []).map((m) => m.id);
        const all = cachedMasters.filter((m) => m.is_active && m.provides_services !== false);
        if (jrnSelectedMasters === null) jrnSelectedMasters = new Set(all.map((m) => m.id));
        if (cb.checked) groupMasters.forEach((id) => jrnSelectedMasters.add(id));
        else groupMasters.forEach((id) => jrnSelectedMasters.delete(id));
        if (jrnSelectedMasters.size === all.length) jrnSelectedMasters = null;
        jrnRenderMasterFilter();
        renderJournal();
      });
    });
  }

  document.getElementById('jrnMasterFilterTrigger')?.addEventListener('click', () => {
    const root = document.getElementById('jrnMasterFilter');
    const panel = document.getElementById('jrnMasterFilterPanel');
    if (!root || !panel) return;
    const open = !panel.hidden;
    panel.hidden = open;
    root.classList.toggle('open', !open);
    if (!open) jrnRenderMasterFilter();
  });
  document.addEventListener('click', (e) => {
    const root = document.getElementById('jrnMasterFilter');
    if (!root) return;
    if (!root.contains(e.target)) {
      const panel = document.getElementById('jrnMasterFilterPanel');
      if (panel) panel.hidden = true;
      root.classList.remove('open');
    }
  });
  document.getElementById('jrnMfAll')?.addEventListener('change', (e) => {
    jrnSelectedMasters = e.target.checked ? null : new Set();
    jrnRenderMasterFilter();
    renderJournal();
  });

  // ===== Schedule master filter (DIKIDI-style dropdown с группировкой) =====
  let schSelectedMasters = null; // Set<id> — null означает «все»
  function schGroupMasters() {
    const groups = new Map();
    cachedMasters.filter((m) => m.is_active).forEach((m) => {
      const role = (m.specialization || '').trim() || 'Другие';
      if (!groups.has(role)) groups.set(role, []);
      groups.get(role).push(m);
    });
    return groups;
  }
  function schIsMasterSelected(id) {
    return !schSelectedMasters || schSelectedMasters.has(id);
  }
  function schRenderMasterFilter() {
    const root = document.getElementById('schMfGroups');
    const allCb = document.getElementById('schMfAll');
    const allCount = document.getElementById('schMfAllCount');
    const trigger = document.getElementById('schMasterFilterLabel');
    const triggerCount = document.getElementById('schMastersCount');
    if (!root) return;
    const groups = schGroupMasters();
    const total = cachedMasters.filter((m) => m.is_active).length;
    const selectedCount = schSelectedMasters ? schSelectedMasters.size : total;

    if (allCb) allCb.checked = !schSelectedMasters || schSelectedMasters.size === total;
    if (allCount) allCount.textContent = String(total);

    // trigger label
    if (selectedCount === total) {
      trigger.textContent = 'Все сотрудники';
      triggerCount.textContent = String(total);
      triggerCount.hidden = false;
    } else if (selectedCount === 1) {
      const id = [...schSelectedMasters][0];
      const m = cachedMasters.find((x) => x.id === id);
      trigger.textContent = m ? (m.display_name || '—') : '—';
      triggerCount.hidden = true;
    } else {
      trigger.textContent = 'Выбрано';
      triggerCount.textContent = `${selectedCount} из ${total}`;
      triggerCount.hidden = false;
    }

    let html = '';
    groups.forEach((arr, role) => {
      const selectedInGroup = arr.filter((m) => schIsMasterSelected(m.id)).length;
      const allChecked = selectedInGroup === arr.length;
      html += `
        <div class="sch-mf-row sch-mf-group" data-group="${escapeHtml(role)}">
          <span class="sch-mf-name">${escapeHtml(role)}</span>
          <span class="sch-mf-count">${arr.length}</span>
          <input type="checkbox" data-grp-cb="${escapeHtml(role)}" ${allChecked ? 'checked' : ''} />
        </div>
      `;
      arr.forEach((m) => {
        const initials = (m.display_name || '?').split(' ').map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
        html += `
          <div class="sch-mf-row sch-mf-master" data-master-id="${m.id}">
            <div class="sch-mf-avatar" style="background:${stringToColor(m.id)}">${escapeHtml(initials || '?')}</div>
            <span class="sch-mf-name">${escapeHtml(m.display_name || '—')}</span>
            <span></span>
            <input type="checkbox" data-master-cb="${m.id}" ${schIsMasterSelected(m.id) ? 'checked' : ''} />
          </div>
        `;
      });
    });
    root.innerHTML = html;

    // wire handlers
    root.querySelectorAll('[data-master-cb]').forEach((cb) => {
      cb.addEventListener('change', () => {
        const id = cb.dataset.masterCb;
        if (schSelectedMasters === null) {
          schSelectedMasters = new Set(cachedMasters.filter((m) => m.is_active).map((m) => m.id));
        }
        if (cb.checked) schSelectedMasters.add(id); else schSelectedMasters.delete(id);
        const t = cachedMasters.filter((m) => m.is_active).length;
        if (schSelectedMasters.size === t) schSelectedMasters = null;
        schRenderMasterFilter();
        renderSchedule();
      });
    });
    root.querySelectorAll('[data-grp-cb]').forEach((cb) => {
      cb.addEventListener('change', () => {
        const role = cb.dataset.grpCb;
        const groupMasters = (schGroupMasters().get(role) || []).map((m) => m.id);
        if (schSelectedMasters === null) {
          schSelectedMasters = new Set(cachedMasters.filter((m) => m.is_active).map((m) => m.id));
        }
        if (cb.checked) groupMasters.forEach((id) => schSelectedMasters.add(id));
        else groupMasters.forEach((id) => schSelectedMasters.delete(id));
        const t = cachedMasters.filter((m) => m.is_active).length;
        if (schSelectedMasters.size === t) schSelectedMasters = null;
        schRenderMasterFilter();
        renderSchedule();
      });
    });
  }
  // wire trigger + outside click + all checkbox
  document.getElementById('schMasterFilterTrigger')?.addEventListener('click', () => {
    const root = document.getElementById('schMasterFilter');
    const panel = document.getElementById('schMasterFilterPanel');
    if (!root || !panel) return;
    const open = !panel.hidden;
    panel.hidden = open;
    root.classList.toggle('open', !open);
    if (!open) schRenderMasterFilter();
  });
  document.addEventListener('click', (e) => {
    const root = document.getElementById('schMasterFilter');
    if (!root) return;
    if (!root.contains(e.target)) {
      document.getElementById('schMasterFilterPanel').hidden = true;
      root.classList.remove('open');
    }
  });
  document.getElementById('schMfAll')?.addEventListener('change', (e) => {
    schSelectedMasters = e.target.checked ? null : new Set();
    schRenderMasterFilter();
    renderSchedule();
  });

  // hook in renderSchedule — фильтрует мастеров через schSelectedMasters
  const _origRenderSchedule = renderSchedule;
  renderSchedule = function() {
    const all = cachedMasters.filter((m) => m.is_active);
    const visible = schSelectedMasters ? all.filter((m) => schSelectedMasters.has(m.id)) : all;
    // временно подменим cachedMasters для рендера
    const backup = cachedMasters;
    cachedMasters = backup.map((m) => ({ ...m, is_active: m.is_active && (schSelectedMasters ? schSelectedMasters.has(m.id) : true) }));
    _origRenderSchedule();
    cachedMasters = backup;
  };

  // ===== Inventory =====
  async function loadInventoryAll() {
    if (!store.access) return;
    await Promise.all([loadProducts(), loadSuppliers(), loadTechCards(), loadMovements()]);
  }

  async function loadProducts() {
    const { ok, data } = await apiCall('GET', '/api/inventory/products', null);
    if (!ok) return;
    cachedProducts = data?.items || [];
    renderProducts();
  }

  async function loadSuppliers() {
    const { ok, data } = await apiCall('GET', '/api/inventory/suppliers', null);
    if (!ok) return;
    cachedSuppliers = data?.items || [];
    populateSupplierDropdown();
  }

  async function loadTechCards() {
    const { ok, data } = await apiCall('GET', '/api/inventory/tech-cards', null);
    if (!ok) return;
    cachedTechCards = data?.items || [];
    renderTechCards();
  }

  async function loadMovements() {
    const { ok, data } = await apiCall('GET', '/api/inventory/stock/movements', null);
    if (!ok) return;
    renderMovements(data?.items || []);
  }

  function renderProducts() {
    if (!els.productsCounter) return;
    els.productsCounter.textContent = String(cachedProducts.length);
    if (cachedProducts.length === 0) {
      els.productsList.innerHTML = '<div class="empty">Расходников пока нет.</div>';
      return;
    }
    const TRACKING_LABEL = {
      auto: { label: '✅ авто', title: 'Автосписание по техкарте при завершении услуги' },
      manual: { label: '✋ вручную', title: 'Списание вручную мастером в конце смены' },
      periodic: { label: '🔄 инвентаризация', title: 'Только при инвентаризации (разница факт/учёт)' },
      expense_only: { label: '💸 в расход', title: 'Не на складе, сразу в Финансы как расход' },
    };
    els.productsList.innerHTML = cachedProducts.map((p) => {
      const stock = Number(p.stock_qty || 0);
      const min = Number(p.min_stock || 0);
      const low = min > 0 && stock < min;
      const stockClass = stock <= 0 ? 'stock-empty' : low ? 'stock-low' : 'stock-ok';
      const tm = TRACKING_LABEL[p.tracking_mode || 'auto'] || TRACKING_LABEL.auto;
      return `
        <div class="row-item ${p.is_active ? '' : 'inactive'}">
          <div class="row-main">
            <div class="row-name">${escapeHtml(p.name)}</div>
            <div class="row-meta">${escapeHtml(p.category || 'без категории')} · мин. ${min} ${escapeHtml(p.unit)}</div>
          </div>
          <span class="tracking-badge tracking-${p.tracking_mode || 'auto'}" title="${escapeHtml(tm.title)}">${tm.label}</span>
          <div class="row-stat ${stockClass}">${stock} ${escapeHtml(p.unit)}</div>
        </div>
      `;
    }).join('');
  }

  function renderTechCards() {
    if (!els.techCardsCounter) return;
    const withCard = cachedTechCards.filter((t) => t.tech_card_id);
    els.techCardsCounter.textContent = `${withCard.length}/${cachedTechCards.length}`;
    if (cachedTechCards.length === 0) {
      els.techCardsList.innerHTML = '<div class="empty">Сначала добавь хотя бы одну услугу.</div>';
      return;
    }
    els.techCardsList.innerHTML = cachedTechCards.map((t) => {
      const has = !!t.tech_card_id;
      const items = (t.items || []).map((it) =>
        `<span class="badge">${escapeHtml(it.product_name)} · ${it.qty_per_service} ${escapeHtml(it.product_unit || '')}</span>`,
      ).join('');
      return `
        <div class="row-item ${has ? '' : 'inactive'}">
          <div class="row-main">
            <div class="row-name">${escapeHtml(t.service_name)}</div>
            <div class="row-meta">${has ? `техкарта v${t.version} · ${(t.items || []).length} позиций` : 'нет техкарты'}</div>
            ${has && items ? `<div class="badges">${items}</div>` : ''}
          </div>
          <button class="btn-ghost btn-xs" data-edit-tc="${t.service_id}">${has ? 'Изменить' : 'Создать'}</button>
        </div>
      `;
    }).join('');
    els.techCardsList.querySelectorAll('button[data-edit-tc]').forEach((btn) => {
      btn.addEventListener('click', () => openTechCardEditor(btn.getAttribute('data-edit-tc')));
    });
  }

  function renderMovements(items) {
    if (!els.movementsCounter) return;
    els.movementsCounter.textContent = String(items.length);
    if (items.length === 0) {
      els.movementsList.innerHTML = '<div class="empty">Движений пока нет.</div>';
      return;
    }
    els.movementsList.innerHTML = items.slice(0, 50).map((m) => {
      const isOut = Number(m.qty) < 0;
      const sourceLabel = m.source_type === 'booking' ? 'запись' :
                          m.source_type === 'supplier_invoice' ? 'накладная' :
                          m.source_type || 'ручная';
      return `
        <div class="row-item movement-row">
          <div class="row-main">
            <div class="row-name">${escapeHtml(m.product_name || '?')}</div>
            <div class="row-meta">${new Date(m.created_at).toLocaleString('ru-RU')} · ${escapeHtml(MOVEMENT_LABEL[m.movement_type] || m.movement_type)} · ${escapeHtml(sourceLabel)}</div>
          </div>
          <div class="row-stat ${isOut ? 'mov-out' : 'mov-in'}">${isOut ? '' : '+'}${m.qty} ${escapeHtml(m.product_unit || '')}</div>
        </div>
      `;
    }).join('');
  }

  function populateSupplierDropdown() {
    if (!els.rSupplier) return;
    els.rSupplier.innerHTML = '<option value="">— без поставщика —</option>' +
      cachedSuppliers.filter((s) => s.is_active).map((s) =>
        `<option value="${s.id}">${escapeHtml(s.name)}</option>`,
      ).join('');
  }

  // ----- Inline add supplier (в форме прихода) -----
  function toggleSupplierAdd(show) {
    if (!els.rSupplierAddInline) return;
    els.rSupplierAddInline.hidden = !show;
    if (show) { els.rSupplierNewName.value = ''; els.rSupplierNewName.focus(); }
  }
  els.rSupplierAddToggle?.addEventListener('click', () => toggleSupplierAdd(els.rSupplierAddInline.hidden));
  els.rSupplierAddCancel?.addEventListener('click', () => toggleSupplierAdd(false));
  async function saveNewSupplier() {
    const name = (els.rSupplierNewName?.value || '').trim();
    if (!name) { toast('Введите название поставщика'); els.rSupplierNewName?.focus(); return; }
    els.rSupplierAddSave.disabled = true;
    const { ok, data, status } = await apiCall('POST', '/api/inventory/suppliers', { name });
    els.rSupplierAddSave.disabled = false;
    if (!ok) {
      toast(status === 409 ? 'Поставщик с таким названием уже есть' : `Ошибка: ${data?.error || status}`);
      return;
    }
    await loadSuppliers();
    if (els.rSupplier && data?.id) els.rSupplier.value = data.id;
    toggleSupplierAdd(false);
    toast('Поставщик добавлен');
  }
  els.rSupplierAddSave?.addEventListener('click', saveNewSupplier);
  els.rSupplierNewName?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); saveNewSupplier(); }
  });

  // ----- Add product -----
  els.addProductToggle?.addEventListener('click', () => {
    els.addProductBlock.open = !els.addProductBlock.open;
    if (els.addReceiptBlock) els.addReceiptBlock.open = false;
  });
  els.addProductCancel?.addEventListener('click', () => {
    els.addProductBlock.open = false;
    els.addProductForm.reset();
  });
  els.addProductForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(els.addProductForm);
    const body = {
      name: String(fd.get('name') || '').trim(),
      unit: String(fd.get('unit') || '').trim() || 'шт',
    };
    const cat = String(fd.get('category') || '').trim();
    if (cat) body.category = cat;
    const min = Number(fd.get('min_stock'));
    if (isFinite(min) && min >= 0) body.min_stock = min;
    const tm = String(fd.get('tracking_mode') || 'auto');
    if (['auto', 'manual', 'periodic', 'expense_only'].includes(tm)) body.tracking_mode = tm;
    const { ok, data, status } = await apiCall('POST', '/api/inventory/products', body);
    if (!ok) { toast(`Ошибка: ${data?.error || status}`); return; }
    els.addProductForm.reset();
    els.addProductBlock.open = false;
    await loadProducts();
  });

  // ----- Receipt -----
  function addReceiptItemRow(prefilled) {
    const row = document.createElement('div');
    row.className = 'recipe-row';
    row.innerHTML = `
      <select class="r-product" required>
        ${cachedProducts.filter((p) => p.is_active).map((p) =>
          `<option value="${p.id}" data-unit="${escapeHtml(p.unit)}">${escapeHtml(p.name)}</option>`,
        ).join('')}
      </select>
      <input type="number" class="r-qty" step="any" min="0.001" required placeholder="кол-во" />
      <input type="number" class="r-cost" step="any" min="0" placeholder="цена за ед." />
      <button type="button" class="r-del" aria-label="удалить">×</button>
    `;
    els.receiptItems.appendChild(row);
    row.querySelector('.r-del').addEventListener('click', () => row.remove());
  }

  els.addReceiptToggle?.addEventListener('click', () => {
    els.addReceiptBlock.open = !els.addReceiptBlock.open;
    if (els.addProductBlock) els.addProductBlock.open = false;
    if (els.addReceiptBlock.open) {
      els.receiptItems.innerHTML = '';
      addReceiptItemRow();
    }
  });
  els.addReceiptCancel?.addEventListener('click', () => {
    els.addReceiptBlock.open = false;
    els.addReceiptForm.reset();
    els.receiptItems.innerHTML = '';
  });
  els.addReceiptItem?.addEventListener('click', () => addReceiptItemRow());

  els.addReceiptForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(els.addReceiptForm);
    const supplier_id = String(fd.get('supplier_id') || '');
    const invoice_number = String(fd.get('invoice_number') || '').trim();
    const items = Array.from(els.receiptItems.querySelectorAll('.recipe-row')).map((row) => {
      const product_id = row.querySelector('.r-product').value;
      const qty = Number(row.querySelector('.r-qty').value);
      const unit_cost = Number(row.querySelector('.r-cost').value) || 0;
      return { product_id, qty, unit_cost };
    }).filter((it) => it.product_id && it.qty > 0);
    if (items.length === 0) { toast('Добавь хотя бы одну позицию'); return; }
    const body = { items };
    if (supplier_id) body.supplier_id = supplier_id;
    if (invoice_number) body.invoice_number = invoice_number;
    const { ok, data, status } = await apiCall('POST', '/api/inventory/receipts', body);
    if (!ok) { toast(`Ошибка: ${data?.error || status}`); return; }
    els.addReceiptForm.reset();
    els.addReceiptBlock.open = false;
    els.receiptItems.innerHTML = '';
    await Promise.all([loadProducts(), loadMovements()]);
  });

  // ----- Tech cards -----
  function addTechCardItemRow(prefilled) {
    const row = document.createElement('div');
    row.className = 'recipe-row';
    row.innerHTML = `
      <select class="tc-product" required>
        ${cachedProducts.filter((p) => p.is_active).map((p) =>
          `<option value="${p.id}" data-unit="${escapeHtml(p.unit)}">${escapeHtml(p.name)} (${escapeHtml(p.unit)})</option>`,
        ).join('')}
      </select>
      <input type="number" class="tc-qty" step="any" min="0.001" required placeholder="кол-во на 1 услугу" />
      <span class="tc-empty"></span>
      <button type="button" class="tc-del" aria-label="удалить">×</button>
    `;
    if (prefilled) {
      row.querySelector('.tc-product').value = prefilled.product_id;
      row.querySelector('.tc-qty').value = prefilled.qty_per_service;
    }
    els.techCardItems.appendChild(row);
    row.querySelector('.tc-del').addEventListener('click', () => row.remove());
  }

  function openTechCardEditor(serviceId) {
    if (cachedProducts.length === 0) {
      toast('Сначала создай хотя бы один расходник.');
      return;
    }
    els.editTechCardBlock.open = true;
    els.tcService.innerHTML = cachedTechCards.map((t) =>
      `<option value="${t.service_id}">${escapeHtml(t.service_name)}</option>`,
    ).join('');
    els.tcService.value = serviceId;
    const tc = cachedTechCards.find((t) => t.service_id === serviceId);
    els.techCardItems.innerHTML = '';
    if (tc?.items?.length) {
      tc.items.forEach((it) => addTechCardItemRow(it));
    } else {
      addTechCardItemRow();
    }
  }

  els.editTechCardToggle?.addEventListener('click', () => {
    if (cachedTechCards.length === 0) { toast('Сначала добавь услугу в "Услуги"'); return; }
    openTechCardEditor(cachedTechCards[0].service_id);
  });
  els.editTechCardCancel?.addEventListener('click', () => {
    els.editTechCardBlock.open = false;
    els.editTechCardForm.reset();
    els.techCardItems.innerHTML = '';
  });
  els.addTechCardItem?.addEventListener('click', () => addTechCardItemRow());

  els.editTechCardForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const service_id = els.tcService.value;
    const items = Array.from(els.techCardItems.querySelectorAll('.recipe-row')).map((row) => {
      const product_id = row.querySelector('.tc-product').value;
      const qty_per_service = Number(row.querySelector('.tc-qty').value);
      return { product_id, qty_per_service };
    }).filter((it) => it.product_id && it.qty_per_service > 0);
    if (items.length === 0) { toast('Добавь хотя бы одну позицию'); return; }
    const { ok, data, status } = await call('PUT', '/api/inventory/tech-cards',
      { service_id, items }, store.access);
    if (!ok) { toast(`Ошибка: ${data?.error || status}`); return; }
    els.editTechCardForm.reset();
    els.editTechCardBlock.open = false;
    els.techCardItems.innerHTML = '';
    await loadTechCards();
  });

  // ===== API log drawer =====
  els.apilogToggle.addEventListener('click', () => {
    els.apilogDrawer.hidden = !els.apilogDrawer.hidden;
  });
  els.apilogClose.addEventListener('click', () => {
    els.apilogDrawer.hidden = true;
  });

  // ===== Backend probe =====
  // Используем public /api/salons/public/services?company=DEFAULT — он 200 OK без auth,
  // не засоряет DevTools console 401-ками.
  async function probeBackend() {
    let res;
    try {
      // Простой OPTIONS на /api/auth — Kong отвечает на CORS preflight 200/204 без передачи в сервис.
      res = await fetch('/api/auth/login', { method: 'OPTIONS' });
    } catch {
      els.dotBackend.className = 'dot dot-down';
      els.statusLabel.textContent = 'Backend недоступен';
      return;
    }
    if (res.status >= 200 && res.status < 500) {
      els.dotBackend.className = 'dot dot-ok';
      els.statusLabel.textContent = 'Backend OK';
    } else {
      els.dotBackend.className = 'dot dot-down';
      els.statusLabel.textContent = `Backend ${res.status}`;
    }
  }

  // ===== Clients =====
  let clientsState = {
    segment: 'all',
    search: '',
    page: 0,
    pageSize: 50,
    items: [],
    total: 0,
    counts: { all: 0, regular: 0, sleeping: 0, missing: 0, never: 0, new: 0, blocked: 0, deleted: 0 },
    loading: false,
    searchTimer: null,
  };

  function clientInitial(name) {
    const s = String(name || '').trim();
    if (!s) return '?';
    const ch = s[0];
    return ch.toUpperCase();
  }

  function formatRuDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    const day = String(d.getDate()).padStart(2, '0');
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const y = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${day}.${m}.${y} в ${hh}:${mm}`;
  }

  function formatPhonePretty(p) {
    const raw = String(p || '');
    const d = raw.replace(/\D/g, '');
    if (raw.startsWith('+7') && d.length === 11) {
      return `+7 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9, 11)}`;
    }
    if (d.length === 11 && d[0] === '7') {
      return `+7 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9, 11)}`;
    }
    return raw;
  }

  function priceOrZero(v) {
    const n = Number(v) || 0;
    if (n === 0) return `<span class="ct-num-zero">0</span>`;
    return escapeHtml(n.toLocaleString('ru-RU'));
  }

  // Single-flight refresh: при параллельных запросах, поймавших 401, ротируемый
  // refresh-токен обменивается ровно один раз. Иначе второй параллельный refresh
  // уходит с уже инвалидированным токеном → ложный разлогин.
  let _refreshInFlight = null;
  function refreshTokens() {
    if (!_refreshInFlight) {
      _refreshInFlight = call('POST', '/api/auth/refresh', { refresh_token: store.refresh })
        .then((res) => {
          if (res.ok && res.data?.access_token) {
            store.access = res.data.access_token;
            if (res.data.refresh_token) store.refresh = res.data.refresh_token;
            return true;
          }
          return false;
        })
        .catch(() => false)
        .finally(() => { _refreshInFlight = null; });
    }
    return _refreshInFlight;
  }

  async function apiCall(method, path, body) {
    const r = await call(method, path, body, store.access);
    if (r.status === 401 && store.refresh) {
      // Прозрачный refresh (дедуплицированный): обновим access и повторим запрос.
      const ok = await refreshTokens();
      if (ok) {
        return await call(method, path, body, store.access);
      }
      // Refresh тоже умер → сессия мертва, очищаем токены и редиректим на профиль.
      store.clear();
      try {
        renderAuth();
        setView('profile');
      } catch { /* noop */ }
    }
    return r;
  }

  async function loadClientsAll() {
    await Promise.all([loadClientsSegments(), loadClientsList()]);
  }

  async function loadClientsSegments() {
    const r = await apiCall('GET', '/api/clients/segments');
    if (r.ok && r.data) {
      clientsState.counts = { ...clientsState.counts, ...r.data };
    }
    renderClientsSegments();
  }

  async function loadClientsList() {
    if (clientsState.loading) return;
    clientsState.loading = true;
    const limit = clientsState.pageSize;
    const offset = clientsState.page * limit;
    const params = new URLSearchParams({
      segment: clientsState.segment,
      limit: String(limit),
      offset: String(offset),
    });
    if (clientsState.search) params.set('search', clientsState.search);
    const r = await apiCall('GET', `/api/clients?${params.toString()}`);
    clientsState.loading = false;
    if (r.ok && r.data) {
      clientsState.items = r.data.items || [];
      clientsState.total = r.data.total || 0;
    } else {
      clientsState.items = [];
      clientsState.total = 0;
    }
    renderClientsList();
  }

  function renderClientsSegments() {
    const total = clientsState.counts.all || 0;
    const html = CLIENT_SEGMENTS.map((s) => {
      const cnt = s.key === 'all' ? total : (clientsState.counts[s.key] ?? 0);
      const cls = clientsState.segment === s.key ? 'client-seg active' : 'client-seg';
      const colCls = s.key === 'all' ? '' : `col-${s.key}`;
      return `
        <li class="${cls}" data-seg="${s.key}">
          <span class="client-seg-label">${escapeHtml(s.label)}</span>
          <span class="client-seg-count ${colCls}">${cnt}</span>
        </li>
        ${s.hint ? `<li class="client-seg-hint">${escapeHtml(s.hint)}</li>` : ''}
      `;
    }).join('');
    els.clientsSegments.innerHTML = html;
    els.clientsSegments.querySelectorAll('.client-seg').forEach((el) => {
      el.addEventListener('click', () => {
        const seg = el.dataset.seg;
        if (seg && seg !== clientsState.segment) {
          clientsState.segment = seg;
          clientsState.page = 0;
          renderClientsSegments();
          void loadClientsList();
        }
      });
    });
  }

  function renderClientsList() {
    if (clientsState.loading && clientsState.items.length === 0) {
      els.clientsList.innerHTML = `<div class="clients-empty">Загрузка…</div>`;
      return;
    }
    if (clientsState.items.length === 0) {
      els.clientsList.innerHTML = `<div class="clients-empty">Клиентов в этой категории нет</div>`;
      els.clientsPagination.hidden = true;
      return;
    }
    const html = clientsState.items.map((c) => {
      const seg = c.segment || 'all';
      const initial = clientInitial(c.full_name);
      const tildeCls = c.full_name && c.full_name.startsWith('~') ? 'tilde' : '';
      const nameClean = c.full_name && c.full_name.startsWith('~')
        ? c.full_name.slice(1).trim() : (c.full_name || '');
      return `
        <div class="clients-row" data-id="${escapeHtml(c.id)}">
          <div class="ct-col ct-col-check"><input type="checkbox" /></div>
          <div class="ct-col ct-col-name">
            <span class="client-avatar" style="background:${escapeHtml(c.avatar_color || '#94a3b8')}">
              <span class="seg-dot seg-${seg}" title="${escapeHtml(seg)}"></span>
              ${escapeHtml(initial)}
            </span>
            <span class="client-name-text">
              <span class="client-name ${tildeCls}">${escapeHtml(nameClean)}</span>
              <span class="client-phone-row">${escapeHtml(formatPhonePretty(c.phone))}</span>
            </span>
          </div>
          <div class="ct-col ct-col-visits" data-label="Визиты">${c.total_visits || 0}</div>
          <div class="ct-col ct-col-last" data-label="Последний визит">${c.last_visit_at ? escapeHtml(formatRuDate(c.last_visit_at)) : '—'}</div>
          <div class="ct-col ct-col-bonus" data-label="Бонусы">${priceOrZero(c.bonus_balance)}</div>
          <div class="ct-col ct-col-avg" data-label="Средний чек">${priceOrZero(c.avg_check)}</div>
          <div class="ct-col ct-col-total" data-label="Итого">${priceOrZero(c.total_paid)}</div>
        </div>
      `;
    }).join('');
    els.clientsList.innerHTML = html;
    els.clientsList.querySelectorAll('.clients-row').forEach((row) => {
      row.addEventListener('click', (e) => {
        // Чекбокс не открывает модалку
        const target = e.target;
        if (target instanceof HTMLInputElement && target.type === 'checkbox') return;
        const id = row.dataset.id;
        if (id) openClientModal(id);
      });
    });
    renderClientsPagination();
  }

  function renderClientsPagination() {
    const total = clientsState.total;
    const size = clientsState.pageSize;
    const pages = Math.max(1, Math.ceil(total / size));
    if (pages <= 1) {
      els.clientsPagination.hidden = true;
      els.clientsPagination.innerHTML = '';
      return;
    }
    els.clientsPagination.hidden = false;
    const cur = clientsState.page;
    const btns = [];
    btns.push(`<button class="clients-page-btn" data-page="${Math.max(0, cur - 1)}" ${cur === 0 ? 'disabled' : ''}>‹</button>`);
    for (let i = 0; i < pages; i++) {
      const cls = i === cur ? 'clients-page-btn active' : 'clients-page-btn';
      btns.push(`<button class="${cls}" data-page="${i}">${i + 1}</button>`);
    }
    btns.push(`<button class="clients-page-btn" data-page="${Math.min(pages - 1, cur + 1)}" ${cur >= pages - 1 ? 'disabled' : ''}>›</button>`);
    els.clientsPagination.innerHTML = btns.join('');
    els.clientsPagination.querySelectorAll('.clients-page-btn').forEach((b) => {
      b.addEventListener('click', () => {
        const p = parseInt(b.dataset.page || '0', 10);
        if (!isNaN(p) && p !== clientsState.page) {
          clientsState.page = p;
          void loadClientsList();
        }
      });
    });
  }

  // ===== Client modal =====
  function switchClientTab(tab) {
    els.clientTabBar.querySelectorAll('.tab-btn').forEach((b) => {
      b.classList.toggle('tab-btn--active', b.dataset.tab === tab);
    });
    els.clientForm.hidden = tab !== 'info';
    els.clientHistoryTab.hidden = tab !== 'history';
    if (els.clientAnalyzesTab) els.clientAnalyzesTab.hidden = tab !== 'analyzes';
    if (tab === 'history') void loadClientHistory();
    if (tab === 'analyzes') void loadClientFiles();
  }

  async function loadClientHistory() {
    const phone = els.clPhone.value.trim();
    if (!phone) {
      els.clientHistoryList.innerHTML = '<div class="table-empty">Визитов не найдено</div>';
      return;
    }
    els.clientHistoryList.innerHTML = '<div class="table-empty">Загрузка…</div>';
    try {
      const res = await apiCall('GET', `/api/bookings?client_phone=${encodeURIComponent(phone)}&from=2000-01-01&to=2099-12-31&limit=100`);
      if (!res.ok || !res.data?.items?.length) {
        els.clientHistoryList.innerHTML = '<div class="table-empty">Визитов не найдено</div>';
        return;
      }
      const items = res.data.items;
      items.sort((a, b) => (b.starts_at || '').localeCompare(a.starts_at || ''));
      const masterMap = new Map(cachedMasters.map((m) => [m.id, m.display_name]));
      els.clientHistoryList.innerHTML = items.map((b) => {
        const d = new Date(b.starts_at);
        const dateStr = isNaN(d.getTime()) ? '—' : `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`;
        const services = (b.services || []).map((s) => s.service_name).join(', ') || '—';
        const master = masterMap.get(b.master_id) || '—';
        const amount = b.total_price != null ? formatPrice(b.total_price) : '—';
        const st = STATUS_LABEL[b.status] || { ru: b.status, cls: '' };
        return `<div class="cl-history-item" data-id="${b.id}">
          <span class="cl-history-date">${dateStr}</span>
          <span class="cl-history-master">${escapeHtml(master)}</span>
          <span class="cl-history-services">${escapeHtml(services)}</span>
          <span class="cl-history-amount">
            <span class="cl-history-status pill ${st.cls}">${st.ru}</span>
            ${amount}
          </span>
        </div>`;
      }).join('');
      els.clientHistoryList.querySelectorAll('.cl-history-item').forEach((row) => {
        row.addEventListener('click', () => {
          const bk = items.find((b) => b.id === row.dataset.id);
          if (bk) { closeClientModal(); openBookingModal(bk); }
        });
      });
    } catch {
      els.clientHistoryList.innerHTML = '<div class="table-empty">Ошибка загрузки истории</div>';
    }
  }

  // ===== Client files (analyzes) =====

  function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' Б';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' КБ';
    return (bytes / (1024 * 1024)).toFixed(1) + ' МБ';
  }

  async function loadClientFiles() {
    if (!_clCurrentId || !els.clFilesList) return;
    els.clFilesList.innerHTML = '<div class="table-empty">Загрузка…</div>';
    try {
      const res = await apiCall('GET', `/api/clients/${_clCurrentId}/files`);
      if (!res.ok) {
        els.clFilesList.innerHTML = '<div class="table-empty">Ошибка загрузки</div>';
        return;
      }
      const items = res.data?.items || [];
      if (!items.length) {
        els.clFilesList.innerHTML = '<div class="table-empty">Файлов нет. Попросите клиента загрузить анализы по ссылке или загрузите сами.</div>';
        return;
      }
      els.clFilesList.innerHTML = items.map((f) => {
        const date = new Date(f.created_at);
        const dateStr = `${String(date.getDate()).padStart(2,'0')}.${String(date.getMonth()+1).padStart(2,'0')}.${date.getFullYear()}`;
        const isImage = f.mime_type?.startsWith('image/');
        const icon = f.mime_type === 'application/pdf' ? '📄' : (isImage ? '🖼' : '📎');
        return `<div class="analyzes-file-row" data-file-id="${f.id}">
          <span class="analyzes-file-icon">${icon}</span>
          <div class="analyzes-file-info">
            <span class="analyzes-file-name">${escapeHtml(f.file_name)}</span>
            <span class="analyzes-file-meta">${formatFileSize(f.file_size)} · ${dateStr} · ${escapeHtml(f.uploaded_by)}</span>
          </div>
          <div class="analyzes-file-actions">
            <a href="/api/clients/${_clCurrentId}/files/${f.id}" target="_blank" class="btn-ghost btn-sm" data-auth-link="${f.id}">Открыть</a>
            <button type="button" class="btn-ghost btn-sm analyzes-del-btn" data-file-id="${f.id}" title="Удалить">✕</button>
          </div>
        </div>`;
      }).join('');
      // Authenticated download links need Authorization header — open via fetch blob
      els.clFilesList.querySelectorAll('[data-auth-link]').forEach((a) => {
        a.addEventListener('click', (e) => {
          e.preventDefault();
          void openFileBlob(_clCurrentId, a.dataset.authLink);
        });
      });
      // Delete buttons
      els.clFilesList.querySelectorAll('.analyzes-del-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!confirm('Удалить файл?')) return;
          await apiCall('DELETE', `/api/clients/${_clCurrentId}/files/${btn.dataset.fileId}`);
          void loadClientFiles();
        });
      });
    } catch {
      els.clFilesList.innerHTML = '<div class="table-empty">Ошибка загрузки</div>';
    }
  }

  async function openFileBlob(clientId, fileId) {
    const token = store.access;
    try {
      const r = await fetch(`/api/clients/${clientId}/files/${fileId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) return;
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch { /* noop */ }
  }

  async function uploadClientFiles(files) {
    if (!_clCurrentId || !files.length) return;
    const MAX = 15 * 1024 * 1024;
    for (const file of files) {
      if (file.size > MAX) {
        toast(`Файл "${file.name}" слишком большой (макс. 15 МБ)`);
        continue;
      }
      const reader = new FileReader();
      const data_base64 = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      await apiCall('POST', `/api/clients/${_clCurrentId}/files`, {
        file_name: file.name,
        mime_type: file.type,
        data_base64,
      });
    }
    void loadClientFiles();
  }

  async function getClientToken() {
    if (!_clCurrentId) return null;
    const res = await apiCall('GET', `/api/clients/${_clCurrentId}/upload-link`);
    return res.ok ? res.data?.upload_token : null;
  }

  async function copyPortalLink() {
    const token = await getClientToken();
    if (!token) { toast('Не удалось получить ссылку'); return; }
    const url = `${location.origin}/portal.html?t=${token}`;
    try {
      await navigator.clipboard.writeText(url);
      const btn = document.getElementById('clCopyPortalLink');
      if (btn) { btn.textContent = '✓ Скопировано'; setTimeout(() => { btn.innerHTML = '&#127968; Личный кабинет'; }, 2000); }
    } catch {
      prompt('Скопируйте ссылку на портал клиента:', url);
    }
  }

  async function copyUploadLink() {
    const token = await getClientToken();
    if (!token) { toast('Не удалось получить ссылку'); return; }
    const url = `${location.origin}/upload.html?token=${token}`;
    try {
      await navigator.clipboard.writeText(url);
      const btn = els.clCopyUploadLink;
      if (btn) { btn.textContent = '✓ Скопировано'; setTimeout(() => { btn.innerHTML = '&#128279; Загрузка файлов'; }, 2000); }
    } catch {
      prompt('Скопируйте ссылку:', url);
    }
  }

  function openClientModal(id) {
    els.clientFormError.hidden = true;
    els.clientFormError.textContent = '';
    els.clientForm.reset();
    switchClientTab('info');
    _clCurrentId = id || null;
    if (id) {
      const c = clientsState.items.find((x) => x.id === id);
      if (!c) return;
      els.clientModalTitle.textContent = 'Клиент';
      els.clientId.value = c.id;
      els.clFullName.value = c.full_name || '';
      els.clPhone.value = c.phone || '';
      els.clBirthday.value = c.birthday || '';
      els.clGender.value = c.gender || '';
      els.clEmail.value = c.email || '';
      els.clComment.value = c.comment || '';
      els.clientDelete.hidden = false;
      els.clientTabHistory.disabled = false;
      if (els.clientTabAnalyzes) els.clientTabAnalyzes.disabled = false;
      const waSendBtn = document.getElementById('clWaSendBtn');
      if (waSendBtn) { waSendBtn.hidden = !c.phone; waSendBtn.dataset.phone = c.phone || ''; }
      const waPortalBtn = document.getElementById('clWaSendPortalBtn');
      if (waPortalBtn) { waPortalBtn.hidden = !c.phone; waPortalBtn.dataset.phone = c.phone || ''; waPortalBtn.dataset.clientId = c.id; }
      // Show bonus section
      if (els.clBonusSection) {
        els.clBonusSection.hidden = false;
        if (els.clBonusDisplay) els.clBonusDisplay.textContent = formatPrice(Number(c.bonus_balance || 0)) + ' бонусов';
        if (els.clBonusAdjForm) els.clBonusAdjForm.hidden = true;
        if (els.clBonusAdjAmount) els.clBonusAdjAmount.value = '';
      }
      // Лицевой счёт (баланс)
      if (els.clBalanceSection) {
        els.clBalanceSection.hidden = false;
        if (els.clBalanceDisplay) els.clBalanceDisplay.textContent = formatPrice(Number(c.balance || 0));
        if (els.clBalanceTopupForm) els.clBalanceTopupForm.hidden = true;
        if (els.clBalanceAmount) els.clBalanceAmount.value = '';
        if (els.clBalanceNote) els.clBalanceNote.value = '';
        void loadClientBalance(c.id);
      }
    } else {
      if (els.clBalanceSection) els.clBalanceSection.hidden = true;
      els.clientModalTitle.textContent = 'Новый клиент';
      els.clientId.value = '';
      els.clientDelete.hidden = true;
      els.clientTabHistory.disabled = true;
      if (els.clientTabAnalyzes) els.clientTabAnalyzes.disabled = true;
      if (els.clBonusSection) els.clBonusSection.hidden = true;
      const waSendBtnNew = document.getElementById('clWaSendBtn');
      if (waSendBtnNew) waSendBtnNew.hidden = true;
    }
    // Открыта из формы записи — поднимаем над её модалкой.
    els.clientModalBackdrop.classList.toggle('modal-backdrop--stacked', isAddBookingOpen());
    els.clientModal.classList.toggle('modal--stacked', isAddBookingOpen());
    els.clientModalBackdrop.hidden = false;
    els.clientModal.hidden = false;
    _clientModalRelease = trapFocus(els.clientModal);
    setTimeout(() => els.clFullName.focus(), 50);
  }

  let _clientModalRelease = null;
  function closeClientModal() {
    _clientModalFromBooking = false;
    els.clientModalBackdrop.hidden = true;
    els.clientModal.hidden = true;
    if (_clientModalRelease) { _clientModalRelease(); _clientModalRelease = null; }
  }

  async function submitClientForm(e) {
    e.preventDefault();
    els.clientFormError.hidden = true;
    const id = els.clientId.value.trim();
    const body = {
      full_name: els.clFullName.value.trim(),
      phone: els.clPhone.value.trim(),
      birthday: els.clBirthday.value || null,
      gender: els.clGender.value || null,
      email: els.clEmail.value.trim() || null,
      comment: els.clComment.value.trim() || null,
    };
    if (!body.full_name || !body.phone) {
      els.clientFormError.hidden = false;
      els.clientFormError.textContent = 'Имя и телефон обязательны';
      return;
    }
    const res = id
      ? await apiCall('PUT', `/api/clients/${id}`, body)
      : await apiCall('POST', '/api/clients', body);
    if (!res.ok) {
      const code = res.data?.code;
      let msg = res.data?.error || 'Ошибка сохранения';
      if (code === 'phone_exists') msg = 'Клиент с таким телефоном уже есть';
      if (code === 'invalid_phone') msg = 'Некорректный телефон';
      els.clientFormError.hidden = false;
      els.clientFormError.textContent = msg;
      return;
    }
    clientsState.page = 0;
    if (!id) fillBookingClientAfterCreate(body);
    closeClientModal();
    await loadClientsAll();
  }

  async function deleteClient() {
    const id = els.clientId.value.trim();
    if (!id) return;
    if (!confirm('Переместить клиента в категорию «Удалены»?')) return;
    const res = await apiCall('DELETE', `/api/clients/${id}`);
    if (!res.ok) {
      els.clientFormError.hidden = false;
      els.clientFormError.textContent = res.data?.error || 'Ошибка';
      return;
    }
    closeClientModal();
    await loadClientsAll();
  }

  // CSV-экспорт строится из текущей страницы. Для MVP достаточно — для полного
  // экспорта позже добавим серверный endpoint. ESC-last-row, BOM для Excel.
  function exportClientsCsv() {
    const a = document.createElement('a');
    a.href = '/api/clients/export.csv';
    a.download = `clients-${todayLocalISO()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function exportBookingsCsv() {
    const { from, to } = getJournalRange();
    const a = document.createElement('a');
    a.href = `/api/bookings/export.csv?from=${from}&to=${to}`;
    a.download = `bookings-${from}_${to}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  // ===== CSV Import =====

  let importParsedRows = [];
  let importColumnMap = {}; // { phone, full_name, email, gender, birthday, comment } → column index

  function parseCsv(text) {
    // Remove BOM if present
    const raw = text.replace(/^﻿/, '');
    // Detect delimiter: comma, semicolon, or tab
    const first = raw.split('\n')[0] || '';
    const delim = first.includes(';') ? ';' : first.includes('\t') ? '\t' : ',';
    const rows = [];
    let inQ = false, cur = '', row = [];
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      if (ch === '"') { inQ = !inQ; }
      else if (!inQ && ch === delim) { row.push(cur.trim()); cur = ''; }
      else if (!inQ && (ch === '\n' || (ch === '\r' && raw[i + 1] === '\n'))) {
        if (ch === '\r') i++;
        row.push(cur.trim()); rows.push(row); row = []; cur = '';
      } else { cur += ch; }
    }
    if (cur || row.length) { row.push(cur.trim()); if (row.some(Boolean)) rows.push(row); }
    return rows;
  }

  function detectColumnMap(headers) {
    const map = {};
    const norm = (s) => s.toLowerCase().replace(/[^а-яёa-z0-9]/gi, '');
    const MATCHES = {
      phone: ['телефон', 'phone', 'тел', 'tel', 'mobile'],
      full_name: ['имя', 'name', 'fullname', 'полноеимя', 'фио', 'клиент'],
      email: ['email', 'почта', 'mail', 'емейл'],
      gender: ['пол', 'gender', 'sex'],
      birthday: ['деньрождения', 'датарождения', 'birthday', 'born', 'dob'],
      comment: ['комментарий', 'примечание', 'comment', 'note', 'notes', 'заметка'],
    };
    headers.forEach((h, idx) => {
      const n = norm(h);
      for (const [field, candidates] of Object.entries(MATCHES)) {
        if (!(field in map) && candidates.some((c) => n.includes(c))) {
          map[field] = idx;
        }
      }
    });
    return map;
  }

  function openImportModal() {
    importParsedRows = [];
    importColumnMap = {};
    document.getElementById('importStep1').hidden = false;
    document.getElementById('importStep2').hidden = true;
    document.getElementById('importStep3').hidden = true;
    document.getElementById('importDoImport').hidden = true;
    document.getElementById('importFileInput').value = '';
    document.getElementById('importModalBackdrop').hidden = false;
    document.getElementById('importModal').hidden = false;
  }

  function closeImportModal() {
    document.getElementById('importModalBackdrop').hidden = true;
    document.getElementById('importModal').hidden = true;
  }

  function showImportPreview(rows) {
    if (!rows.length) { toast('Файл пустой'); return; }
    const headers = rows[0];
    importColumnMap = detectColumnMap(headers);
    importParsedRows = rows.slice(1).filter((r) => r.some(Boolean));

    document.getElementById('importStep1').hidden = true;
    document.getElementById('importStep2').hidden = false;
    document.getElementById('importDoImport').hidden = false;

    const info = document.getElementById('importPreviewInfo');
    const hasPh = 'phone' in importColumnMap;
    const hasNm = 'full_name' in importColumnMap;
    info.innerHTML = `Строк данных: <strong>${importParsedRows.length}</strong>. ` +
      (hasPh && hasNm
        ? `Колонки распознаны: ${Object.entries(importColumnMap).map(([k, v]) => `${headers[v]} → ${k}`).join(', ')}.`
        : `<span style="color:var(--danger)">⚠ Не найдены обязательные колонки «Телефон» и/или «Имя».</span>`);
    document.getElementById('importDoImport').disabled = !(hasPh && hasNm);

    // Preview table (first 5 rows)
    const tbl = document.getElementById('importPreviewTable');
    const preview = importParsedRows.slice(0, 5);
    tbl.innerHTML = `<thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>` +
      `<tbody>${preview.map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody>`;
  }

  async function doImport() {
    const btn = document.getElementById('importDoImport');
    btn.disabled = true;
    btn.textContent = 'Импортирую…';
    const m = importColumnMap;
    const apiRows = importParsedRows.map((r) => ({
      phone: r[m.phone] || '',
      full_name: r[m.full_name] || '',
      email: m.email != null ? r[m.email] : undefined,
      gender: m.gender != null ? r[m.gender] : undefined,
      birthday: m.birthday != null ? r[m.birthday] : undefined,
      comment: m.comment != null ? r[m.comment] : undefined,
    })).filter((r) => r.phone && r.full_name);

    try {
      const result = await apiCall('POST', '/api/clients/import', { rows: apiRows });
      document.getElementById('importStep2').hidden = true;
      document.getElementById('importStep3').hidden = false;
      const resEl = document.getElementById('importResultMsg');
      const detEl = document.getElementById('importResultDetail');
      resEl.innerHTML = `✅ Импорт завершён: создано <strong>${result.created}</strong>, обновлено <strong>${result.updated}</strong>`;
      if (result.errors?.length) {
        detEl.innerHTML = `<span style="color:var(--danger)">Ошибок: ${result.errors.length}</span>`;
      } else {
        detEl.textContent = `Всего обработано: ${result.total}`;
      }
      document.getElementById('importDoImport').hidden = true;
      void loadClientsAll();
    } catch (e) {
      toast('Ошибка импорта: ' + e.message);
      btn.disabled = false;
      btn.textContent = 'Импортировать';
    }
  }

  // Wire import modal
  document.getElementById('clientsImportBtn')?.addEventListener('click', () => {
    document.getElementById('clientsMoreMenu').hidden = true;
    openImportModal();
  });
  document.getElementById('importModalClose')?.addEventListener('click', closeImportModal);
  document.getElementById('importModalCancel')?.addEventListener('click', closeImportModal);
  document.getElementById('importModalBackdrop')?.addEventListener('click', closeImportModal);
  document.getElementById('importDoImport')?.addEventListener('click', doImport);

  document.getElementById('importFileInput')?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => showImportPreview(parseCsv(ev.target.result));
    reader.readAsText(file, 'UTF-8');
  });

  const dropzone = document.getElementById('importDropzone');
  if (dropzone) {
    dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('drag-over'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => showImportPreview(parseCsv(ev.target.result));
      reader.readAsText(file, 'UTF-8');
    });
  }

  // ===== Bonus program =====

  // Cached bonus settings from company profile (single source of truth = settings_jsonb.bonus)
  let _bonusSettingsCache = null;
  const BONUS_DEFAULTS = { accrual_rate: 5, max_spend_pct: 30, enabled: true };

  function loadBonusSettings() {
    // If company profile already loaded (from Settings view), use it
    if (cachedCompanyProfile?.settings_jsonb?.bonus) {
      return { ...BONUS_DEFAULTS, ...cachedCompanyProfile.settings_jsonb.bonus };
    }
    // Fallback: use local cache if populated this session
    if (_bonusSettingsCache) return _bonusSettingsCache;
    // Last resort: old localStorage key for backwards compatibility
    try {
      const ls = JSON.parse(localStorage.getItem('samaya_bonus_settings_v1') || 'null');
      return ls ? { ...BONUS_DEFAULTS, ...ls } : BONUS_DEFAULTS;
    } catch { return BONUS_DEFAULTS; }
  }

  async function ensureBonusSettings() {
    if (cachedCompanyProfile?.settings_jsonb) return;
    const r = await setApi('GET', '/company');
    if (r.ok) {
      cachedCompanyProfile = r.data;
      _bonusSettingsCache = cachedCompanyProfile?.settings_jsonb?.bonus || null;
    }
  }

  async function saveBonusSettingsToDb(s) {
    await ensureBonusSettings();
    const settings = { ...(cachedCompanyProfile?.settings_jsonb || {}) };
    settings.bonus = s;
    const r = await setApi('PUT', '/company', { settings_jsonb: settings });
    if (r.ok) {
      cachedCompanyProfile = r.data;
      _bonusSettingsCache = s;
    }
    return r.ok;
  }

  function initBonusSettingsForm() {
    const s = loadBonusSettings();
    if (els.bonusAccrualRate) els.bonusAccrualRate.value = s.accrual_rate;
    if (els.bonusMaxSpend) els.bonusMaxSpend.value = s.max_spend_pct;
  }

  els.bonusSettingsSave?.addEventListener('click', async () => {
    const s = {
      accrual_rate: Math.max(0, Math.min(100, parseFloat(els.bonusAccrualRate?.value) || 0)),
      max_spend_pct: Math.max(0, Math.min(100, parseFloat(els.bonusMaxSpend?.value) || 0)),
      enabled: true,
    };
    const ok = await saveBonusSettingsToDb(s);
    if (els.bonusSettingsSaved) {
      els.bonusSettingsSaved.textContent = ok ? 'Сохранено ✓' : 'Ошибка сохранения';
      els.bonusSettingsSaved.hidden = false;
      setTimeout(() => { if (els.bonusSettingsSaved) els.bonusSettingsSaved.hidden = true; }, 2500);
    }
  });

  async function activateBonusTab() {
    await ensureBonusSettings();
    initBonusSettingsForm();
    const r = await apiCall('GET', '/api/clients?segment=all&limit=200');
    if (!r.ok || !r.data) return;
    const items = (r.data.items || [])
      .filter((c) => Number(c.bonus_balance) > 0)
      .sort((a, b) => Number(b.bonus_balance) - Number(a.bonus_balance))
      .slice(0, 50);
    if (els.bonusTopCounter) els.bonusTopCounter.textContent = String(items.length);
    if (!els.bonusTopList) return;
    if (!items.length) {
      els.bonusTopList.innerHTML = '<div class="empty">Нет клиентов с бонусным балансом.</div>';
      return;
    }
    els.bonusTopList.innerHTML = items.map((c) => `
      <div class="row-item">
        <div class="row-main">
          <div class="row-name">${escapeHtml(c.full_name)}</div>
          <div class="row-meta">${escapeHtml(c.phone)}${c.last_visit_at ? ' · Визит: ' + escapeHtml(c.last_visit_at.slice(0, 10)) : ''}</div>
        </div>
        <div class="row-stat fin-pos">${formatPrice(Number(c.bonus_balance))} бонусов</div>
      </div>
    `).join('');
  }

  // Clients sub-tab switching (list / bonus)
  let clientsActiveTab = 'list';

  function switchClientsTab(tab) {
    clientsActiveTab = tab;
    document.querySelectorAll('#clientsSubnav .subnav-item[data-clients-tab]').forEach((b) => {
      b.classList.toggle('active', b.dataset.clientsTab === tab);
    });
    const listEl = document.getElementById('clientsTabList');
    if (listEl) listEl.hidden = (tab !== 'list');
    if (els.clientsTabBonus) els.clientsTabBonus.hidden = (tab !== 'bonus');
    if (tab === 'bonus') void activateBonusTab();
  }

  els.clientsSubnav?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-clients-tab]');
    if (!btn || btn.classList.contains('disabled')) return;
    switchClientsTab(btn.dataset.clientsTab);
  });

  // Client modal bonus section
  let _clCurrentId = null; // set by openClientModal, used for bonus adj

  // ===== Лицевой счёт клиента: загрузка счетов + история, пополнение =====
  async function loadClientBalance(clientId) {
    if (els.clBalanceAccount) {
      const ra = await apiCall('GET', '/api/finance/accounts');
      const accs = ra.ok ? (ra.data?.items || []) : [];
      els.clBalanceAccount.innerHTML = '<option value="">— счёт (нал/безнал) —</option>'
        + accs.filter((a) => a.is_active !== false)
            .map((a) => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)} (${a.type === 'cash' ? 'нал' : 'безнал'})</option>`).join('');
    }
    if (els.clBalanceOps) {
      const ro = await apiCall('GET', `/api/clients/${clientId}/balance/operations`);
      const ops = ro.ok ? (ro.data?.items || []) : [];
      els.clBalanceOps.innerHTML = ops.length
        ? ops.map((o) => {
            const sign = (o.kind === 'topup' || o.kind === 'refund') ? '+' : (o.kind === 'charge' ? '−' : '');
            const pm = o.payment_method === 'cash' ? 'нал' : o.payment_method === 'cashless' ? 'безнал' : '';
            const date = new Date(o.created_at).toLocaleDateString('ru-RU');
            const label = o.kind === 'topup' ? 'Пополнение' : o.kind === 'charge' ? 'Списание' : o.kind === 'refund' ? 'Возврат' : 'Коррекция';
            return `<div class="cl-balance-op"><span>${date} · ${label}${pm ? ' · ' + pm : ''}${o.note ? ' · ' + escapeHtml(o.note) : ''}</span><b>${sign}${formatPrice(o.amount)}</b></div>`;
          }).join('')
        : '<div class="empty" style="padding:8px 0;font-size:var(--fs-sm)">Операций пока нет.</div>';
    }
  }
  els.clBalanceTopupBtn?.addEventListener('click', () => {
    if (els.clBalanceTopupForm) { els.clBalanceTopupForm.hidden = !els.clBalanceTopupForm.hidden; els.clBalanceAmount?.focus(); }
  });
  els.clBalanceCancel?.addEventListener('click', () => { if (els.clBalanceTopupForm) els.clBalanceTopupForm.hidden = true; });
  els.clBalanceSave?.addEventListener('click', async () => {
    const id = _clCurrentId;
    if (!id) return;
    const amount = Number(els.clBalanceAmount?.value);
    const account_id = els.clBalanceAccount?.value || null;
    const note = els.clBalanceNote?.value?.trim() || undefined;
    if (!amount || amount <= 0) { toast('Введите сумму пополнения'); return; }
    const r = await apiCall('POST', `/api/clients/${id}/balance/topup`, { amount, account_id, note });
    if (!r.ok) { toast('Ошибка: ' + (r.data?.error || r.status)); return; }
    if (els.clBalanceDisplay) els.clBalanceDisplay.textContent = formatPrice(Number(r.data?.balance || 0));
    if (els.clBalanceTopupForm) els.clBalanceTopupForm.hidden = true;
    if (els.clBalanceAmount) els.clBalanceAmount.value = '';
    if (els.clBalanceNote) els.clBalanceNote.value = '';
    const c = clientsState.items.find((x) => x.id === id);
    if (c) c.balance = r.data?.balance;
    toast('Баланс пополнен');
    void loadClientBalance(id);
  });

  els.clBonusAdjBtn?.addEventListener('click', () => {
    if (els.clBonusAdjForm) els.clBonusAdjForm.hidden = false;
    els.clBonusAdjAmount?.focus();
  });
  els.clBonusAdjCancel?.addEventListener('click', () => {
    if (els.clBonusAdjForm) els.clBonusAdjForm.hidden = true;
    if (els.clBonusAdjAmount) els.clBonusAdjAmount.value = '';
    if (els.clBonusAdjNote) els.clBonusAdjNote.value = '';
  });
  els.clBonusAdjSave?.addEventListener('click', async () => {
    if (!_clCurrentId) return;
    const delta = parseFloat(els.clBonusAdjAmount?.value) || 0;
    if (delta === 0) { toast('Введите сумму изменения.'); return; }
    const existing = clientsState.items.find((c) => c.id === _clCurrentId);
    const currentBalance = Number(existing?.bonus_balance || 0);
    const newBalance = Math.max(0, currentBalance + delta);
    const r = await apiCall('PATCH', `/api/clients/${_clCurrentId}`, { bonus_balance: newBalance });
    if (!r.ok) { toast('Ошибка: ' + (r.data?.error || r.status)); return; }
    if (els.clBonusDisplay) els.clBonusDisplay.textContent = formatPrice(newBalance) + ' бонусов';
    if (els.clBonusAdjForm) els.clBonusAdjForm.hidden = true;
    if (els.clBonusAdjAmount) els.clBonusAdjAmount.value = '';
    if (els.clBonusAdjNote) els.clBonusAdjNote.value = '';
    // Update local cache
    if (existing) existing.bonus_balance = String(newBalance);
  });

  // Wire up clients view UI events (один раз при загрузке)
  if (els.clientsSearch) {
    els.clientsSearch.addEventListener('input', () => {
      clearTimeout(clientsState.searchTimer);
      clientsState.searchTimer = setTimeout(() => {
        clientsState.search = els.clientsSearch.value.trim();
        clientsState.page = 0;
        void loadClientsList();
      }, 300);
    });
  }
  if (els.clientsAddBtn) {
    els.clientsAddBtn.addEventListener('click', () => openClientModal(null));
  }
  if (els.clientForm) els.clientForm.addEventListener('submit', submitClientForm);
  if (els.clientCancel) els.clientCancel.addEventListener('click', closeClientModal);
  if (els.clientModalClose) els.clientModalClose.addEventListener('click', closeClientModal);
  if (els.clientModalBackdrop) els.clientModalBackdrop.addEventListener('click', closeClientModal);
  if (els.clientDelete) els.clientDelete.addEventListener('click', deleteClient);

  document.getElementById('clWaSendPortalBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('clWaSendPortalBtn');
    const phone = btn?.dataset.phone || '';
    if (!phone) return;
    btn.disabled = true;
    btn.textContent = '⏳';
    try {
      const tokenRes = await apiCall('GET', `/api/clients/${btn.dataset.clientId}/upload-link`);
      if (!tokenRes.ok) { toast('Не удалось получить токен портала'); return; }
      const portalUrl = `${location.origin}/portal.html?t=${tokenRes.data.upload_token}`;
      const message = `Здравствуйте! Ваш личный кабинет Samaya — история визитов, бонусы и онлайн-запись: ${portalUrl}`;
      const r = await apiCall('POST', '/api/whatsapp/send', { phone, message });
      if (r.ok) {
        btn.textContent = '✓ Отправлено';
        setTimeout(() => { btn.textContent = '🏠 Портал в WA'; btn.disabled = false; }, 3000);
      } else {
        toast('Ошибка: ' + (r.data?.error || r.status));
        btn.disabled = false;
        btn.innerHTML = '&#127968; Портал в WA';
      }
    } catch {
      btn.disabled = false;
      btn.innerHTML = '&#127968; Портал в WA';
    }
  });

  document.getElementById('clWaSendBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('clWaSendBtn');
    const phone = btn?.dataset.phone || '';
    if (!phone) return;
    const message = prompt('Сообщение для клиента (WhatsApp):', '');
    if (!message) return;
    btn.disabled = true;
    try {
      const r = await apiCall('POST', '/api/whatsapp/send', { phone, message });
      if (r.ok) {
        toast('Сообщение отправлено!');
      } else {
        toast('Ошибка: ' + (r.data?.error || r.status));
      }
    } finally {
      btn.disabled = false;
    }
  });

  if (els.clientTabBar) {
    els.clientTabBar.addEventListener('click', (e) => {
      const btn = e.target.closest('.tab-btn');
      if (btn && !btn.disabled) switchClientTab(btn.dataset.tab);
    });
  }
  if (els.clFileUpload) {
    els.clFileUpload.addEventListener('change', (e) => {
      const files = Array.from(e.target.files || []);
      e.target.value = '';
      void uploadClientFiles(files);
    });
  }
  if (els.clCopyUploadLink) {
    els.clCopyUploadLink.addEventListener('click', () => void copyUploadLink());
  }
  document.getElementById('clCopyPortalLink')?.addEventListener('click', () => void copyPortalLink());
  if (els.clientsMoreBtn) {
    els.clientsMoreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      els.clientsMoreMenu.hidden = !els.clientsMoreMenu.hidden;
    });
    document.addEventListener('click', () => {
      if (els.clientsMoreMenu) els.clientsMoreMenu.hidden = true;
    });
  }
  if (els.clientsExportCsv) {
    els.clientsExportCsv.addEventListener('click', () => {
      els.clientsMoreMenu.hidden = true;
      exportClientsCsv();
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && els.clientModal && !els.clientModal.hidden) closeClientModal();
  });

  // ===== Finance (backed by finance-service via /api/finance) =====
  let cachedFinAccounts = [];
  let cachedFinOps = [];
  let cachedFinCategories = { income: [], expense: [] };
  let cachedFinSummary = null;
  let cachedFinCounterparties = [];
  let finMigrationDone = false;
  // Phase 2 state
  let finPeriod = localStorage.getItem('fin_period') || 'today';
  const finFilters = { account_id: '', category_id: '', kind: '', payment_method: '' };

  // Возвращает {from, to, label} для текущего period.
  function finPeriodRange(period) {
    const today = todayLocalISO();
    if (period === 'today') return { from: today, to: today, label: 'сегодня' };
    if (period === 'yesterday') {
      const y = addDaysISO(today, -1);
      return { from: y, to: y, label: 'вчера' };
    }
    if (period === 'week') {
      // Понедельник-воскресенье текущей недели
      const [yr, mo, d] = today.split('-').map(Number);
      const dt = new Date(yr, mo - 1, d);
      const dow = dt.getDay(); // 0=вс
      const offset = dow === 0 ? -6 : 1 - dow;
      const from = addDaysISO(today, offset);
      const to = addDaysISO(from, 6);
      return { from, to, label: 'эта неделя' };
    }
    if (period === 'month') {
      const monthStart = today.slice(0, 7) + '-01';
      const [y, m] = today.split('-').map(Number);
      const lastDay = new Date(y, m, 0).getDate();
      const monthEnd = `${today.slice(0, 7)}-${String(lastDay).padStart(2, '0')}`;
      return { from: monthStart, to: monthEnd, label: 'этот месяц' };
    }
    if (period === 'year') {
      const y = today.slice(0, 4);
      return { from: `${y}-01-01`, to: `${y}-12-31`, label: 'этот год' };
    }
    return { from: today, to: today, label: 'сегодня' };
  }

  async function finApi(method, path, body) {
    return apiCall(method, '/api/finance' + path, body);
  }

  async function finPopulateCategorySelect(selectEl, kind) {
    if (!selectEl) return;
    if (!cachedFinCategories[kind].length) {
      const r = await finApi('GET', `/categories?kind=${kind}`);
      if (r.ok) cachedFinCategories[kind] = r.data?.items || [];
    }
    const cur = selectEl.value;
    selectEl.innerHTML = '<option value="">— без категории —</option>'
      + cachedFinCategories[kind].map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('');
    if (cur) selectEl.value = cur;
  }

  function finPopulateAccountSelects(skipId) {
    const opts = cachedFinAccounts
      .filter((a) => a.is_active)
      .map((a) => `<option value="${escapeHtml(a.id)}"${a.id === skipId ? ' disabled' : ''}>${escapeHtml(a.name)}</option>`)
      .join('');
    [els.finIncomeAccount, els.finExpenseAccount, els.finTransferFrom, els.finTransferTo].forEach((sel) => {
      if (sel) sel.innerHTML = opts || '<option value="">— нет счетов —</option>';
    });
  }

  async function migrateLocalStorageFinance() {
    if (finMigrationDone) return;
    finMigrationDone = true;
    let raw;
    try { raw = JSON.parse(localStorage.getItem('fin_data') || 'null'); } catch { return; }
    if (!raw || !raw.accounts?.length) return;
    if (cachedFinAccounts.length > 0) {
      // Backend уже наполнен — миграция не нужна, чистим LS чтобы не предлагать снова.
      localStorage.removeItem('fin_data');
      return;
    }
    if (!confirm(`Найдены сохранённые в браузере данные финансов: ${raw.accounts.length} счёт(ов), ${raw.transactions?.length || 0} операций. Перенести на сервер?`)) {
      localStorage.setItem('fin_data_migration_skipped_at', String(Date.now()));
      return;
    }
    const idMap = new Map();
    let okCount = 0; let failCount = 0;
    for (const a of raw.accounts) {
      const r = await finApi('POST', '/accounts', {
        name: a.name, type: 'cash', initial_balance: 0,
      });
      if (r.ok) { idMap.set(a.id, r.data.id); okCount++; } else failCount++;
    }
    for (const t of raw.transactions || []) {
      const accId = idMap.get(t.account_id);
      if (!accId) { failCount++; continue; }
      const opDate = (t.date || todayLocalISO()).slice(0, 10);
      let r;
      if (t.type === 'income') {
        r = await finApi('POST', '/operations/income', {
          account_id: accId, amount: Number(t.amount) || 0, op_date: opDate, note: t.note || t.category || '',
        });
      } else if (t.type === 'expense') {
        r = await finApi('POST', '/operations/expense', {
          account_id: accId, amount: Number(t.amount) || 0, op_date: opDate, note: t.note || t.category || '',
        });
      } else if (t.type === 'transfer') {
        const toId = idMap.get(t.to_account_id);
        if (!toId) { failCount++; continue; }
        r = await finApi('POST', '/operations/transfer', {
          from_account_id: accId, to_account_id: toId, amount: Number(t.amount) || 0, op_date: opDate, note: t.note || '',
        });
      }
      if (r?.ok) okCount++; else failCount++;
    }
    if (failCount === 0) {
      localStorage.removeItem('fin_data');
      toast(`Перенесено ${okCount} записей. Локальные данные удалены.`);
    } else {
      toast(`Перенесено ${okCount} из ${okCount + failCount}. Локальные данные оставлены — попробуйте ещё раз.`);
    }
  }

  async function loadFinanceData() {
    if (!store.access) return;
    const range = finPeriodRange(finPeriod);
    // Build operations query with filters
    let opsQuery = `from=${range.from}&to=${range.to}&limit=200`;
    if (finFilters.account_id) opsQuery += `&account_id=${finFilters.account_id}`;
    if (finFilters.category_id) opsQuery += `&category_id=${finFilters.category_id}`;
    if (finFilters.kind) opsQuery += `&kind=${finFilters.kind}`;
    if (finFilters.payment_method) opsQuery += `&payment_method=${finFilters.payment_method}`;
    const [accR, opsR, sumR] = await Promise.all([
      finApi('GET', '/accounts'),
      finApi('GET', `/operations?${opsQuery}`),
      finApi('GET', `/summary?from=${range.from}&to=${range.to}`),
    ]);
    if (accR.ok) cachedFinAccounts = accR.data?.items || [];
    if (opsR.ok) cachedFinOps = opsR.data?.items || [];
    if (sumR.ok) cachedFinSummary = sumR.data;
    // Preload categories for filter drawer (если ещё не подгружены)
    if (!cachedFinCategories.income.length && !cachedFinCategories.expense.length) {
      const [catIn, catEx] = await Promise.all([
        finApi('GET', '/categories?kind=income'),
        finApi('GET', '/categories?kind=expense'),
      ]);
      if (catIn.ok) cachedFinCategories.income = catIn.data?.items || [];
      if (catEx.ok) cachedFinCategories.expense = catEx.data?.items || [];
    }
    await migrateLocalStorageFinance();
    if (cachedFinAccounts.length || cachedFinOps.length) {
      // Если миграция что-то добавила — перечитать.
      const [accR2, opsR2, sumR2] = await Promise.all([
        finApi('GET', '/accounts'),
        finApi('GET', `/operations?${opsQuery}`),
        finApi('GET', `/summary?from=${range.from}&to=${range.to}`),
      ]);
      if (accR2.ok) cachedFinAccounts = accR2.data?.items || [];
      if (opsR2.ok) cachedFinOps = opsR2.data?.items || [];
      if (sumR2.ok) cachedFinSummary = sumR2.data;
    }
  }

  async function renderFinanceView() {
    ['overview', 'accounts', 'ops', 'categories', 'counterparties', 'certificates'].forEach((t) => {
      const panel = document.getElementById(`finTab${t.charAt(0).toUpperCase() + t.slice(1)}`);
      if (panel) panel.hidden = t !== financeTab;
    });
    document.querySelectorAll('[data-fin-tab]').forEach((b) => {
      b.classList.toggle('active', b.dataset.finTab === financeTab);
    });
    if (financeTab === 'categories') { await renderFinCategories(); return; }
    if (financeTab === 'counterparties') { await renderFinCounterparties(); return; }
    if (financeTab === 'certificates') { await renderCertificates(); return; }
    await loadFinanceData();
    if (financeTab === 'overview') renderFinOverview();
    else if (financeTab === 'accounts') renderFinAccounts();
    else renderFinOps();
  }

  function opSign(kind) {
    if (kind === 'income' || kind === 'transfer_in') return '+';
    if (kind === 'expense' || kind === 'transfer_out') return '−';
    return '±';
  }
  function opCls(kind) {
    if (kind === 'income' || kind === 'transfer_in') return 'fin-pos';
    if (kind === 'expense' || kind === 'transfer_out') return 'fin-neg';
    return 'fin-move';
  }
  function opLabel(o) {
    if (o.kind === 'transfer_in') return 'Перемещение (получено)';
    if (o.kind === 'transfer_out') return 'Перемещение (отправлено)';
    if (o.kind === 'adjust') return 'Корректировка остатка';
    return o.category_name || (o.kind === 'income' ? 'Доход' : 'Расход');
  }

  function renderFinOverview() {
    const s = cachedFinSummary || { income: 0, expense: 0, profit: 0, opening_balance: 0, closing_balance: 0, by_account_type: {} };
    // KPI values
    if (els.finKpiIncome) els.finKpiIncome.textContent = formatPrice(s.income);
    if (els.finKpiExpense) els.finKpiExpense.textContent = formatPrice(s.expense);
    // Разбивка нал/безнал под доходами и расходами
    const pm = s.by_payment_method || { cash: { income: 0, expense: 0 }, cashless: { income: 0, expense: 0 } };
    const breakdownHtml = (kind) =>
      `<span class="fin-bd-cash">нал ${formatPrice(pm.cash?.[kind] || 0)}</span>`
      + `<span class="fin-bd-cashless">безнал ${formatPrice(pm.cashless?.[kind] || 0)}</span>`;
    const incBd = document.getElementById('finKpiIncomeBreakdown');
    const expBd = document.getElementById('finKpiExpenseBreakdown');
    if (incBd) incBd.innerHTML = breakdownHtml('income');
    if (expBd) expBd.innerHTML = breakdownHtml('expense');
    if (els.finKpiProfit) {
      els.finKpiProfit.textContent = formatPrice(s.profit);
      els.finKpiProfit.style.color = s.profit >= 0 ? '#16a34a' : '#dc2626';
    }
    const openingEl = document.getElementById('finKpiOpening');
    const closingEl = document.getElementById('finKpiClosing');
    if (openingEl) openingEl.textContent = formatPrice(s.opening_balance);
    if (closingEl) closingEl.textContent = formatPrice(s.closing_balance);

    // Donut by account type — % cash из totals
    const byType = s.by_account_type || {};
    const total = Object.values(byType).reduce((a, b) => a + Math.abs(Number(b) || 0), 0);
    const cashPct = total > 0 ? Math.round((Math.abs(byType.cash || 0) / total) * 100) : 0;
    const opArc = document.getElementById('finKpiDonutOpeningArc');
    const clArc = document.getElementById('finKpiDonutClosingArc');
    if (opArc) opArc.setAttribute('stroke-dasharray', `${cashPct} ${100 - cashPct}`);
    if (clArc) clArc.setAttribute('stroke-dasharray', `${cashPct} ${100 - cashPct}`);

    // Account-type legend
    const legendEl = document.getElementById('finAccountLegend');
    if (legendEl) {
      const TYPE_INFO = {
        cash: { label: 'Наличные', color: '#3b82f6' },
        bank: { label: 'Расчётные', color: '#16a34a' },
        personal: { label: 'Личные', color: '#a78bfa' },
        other: { label: 'Прочие', color: '#94a3b8' },
      };
      const items = Object.entries(byType).map(([k, v]) => {
        const info = TYPE_INFO[k] || { label: k, color: '#94a3b8' };
        return `<span class="fin-account-legend-item">
          <span class="fin-account-legend-dot" style="background:${info.color}"></span>
          <span class="fin-account-legend-name">${escapeHtml(info.label)}</span>
          <span class="fin-account-legend-val">${formatPrice(v)}</span>
        </span>`;
      });
      legendEl.innerHTML = items.length ? items.join('') : '<span class="fin-account-legend-name">Нет счетов</span>';
    }

    // Period label
    const labelEl = document.getElementById('finPeriodLabel');
    if (labelEl) {
      const range = finPeriodRange(finPeriod);
      labelEl.textContent = `${range.label} · ${range.from === range.to ? range.from : range.from + ' – ' + range.to}`;
    }

    // Refresh filter dropdowns
    finUpdateFilterDropdowns();

    if (els.finTransCounter) els.finTransCounter.textContent = String(cachedFinOps.length);
    if (!els.finTransList) return;
    if (cachedFinOps.length === 0) {
      els.finTransList.innerHTML = '<div class="empty">Транзакций пока нет. Нажмите «+ Доход» или «+ Расход».</div>';
      return;
    }
    els.finTransList.innerHTML = cachedFinOps.map((o) => `
      <div class="row-item fin-trans-row">
        <div class="row-main">
          <div class="row-name">${escapeHtml(opLabel(o))}</div>
          <div class="row-meta">${escapeHtml(o.op_date.slice(0, 10))} · ${escapeHtml(o.account_name || '—')}${o.counterparty_name ? ' · ' + escapeHtml(o.counterparty_name) : ''}${o.note ? ' · ' + escapeHtml(o.note) : ''}</div>
        </div>
        <div class="row-stat ${opCls(o.kind)}">${opSign(o.kind)} ${formatPrice(o.amount)}</div>
        <button type="button" class="fin-del-btn" data-delid="${escapeHtml(o.id)}" aria-label="Удалить">×</button>
      </div>
    `).join('');
    els.finTransList.querySelectorAll('.fin-del-btn[data-delid]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Удалить операцию?')) return;
        const r = await finApi('DELETE', `/operations/${btn.dataset.delid}`);
        if (!r.ok) { toast('Ошибка: ' + (r.data?.error || r.status)); return; }
        await renderFinanceView();
      });
    });
  }

  function renderFinAccounts() {
    if (els.finAccountsCounter) els.finAccountsCounter.textContent = String(cachedFinAccounts.length);
    if (!els.finAccountsList) return;
    if (cachedFinAccounts.length === 0) {
      els.finAccountsList.innerHTML = '<div class="empty">Счетов пока нет. Нажмите «+ Счёт».</div>';
      return;
    }
    const TYPE_LABEL = { cash: 'Касса', bank: 'Расчётный счёт', personal: 'Личный', other: 'Прочее' };
    els.finAccountsList.innerHTML = cachedFinAccounts.map((a) => `
      <div class="row-item fin-account-row${a.is_active ? '' : ' inactive'}">
        <div class="row-main">
          <div class="row-name">${escapeHtml(a.name)}${a.is_active ? '' : ' <span class="row-meta">(архив)</span>'}</div>
          <div class="row-meta">${escapeHtml(TYPE_LABEL[a.type] || a.type)}</div>
        </div>
        <div class="row-stat fin-account-bal">${formatPrice(a.current_balance)}</div>
        <button type="button" class="fin-del-btn" data-delaccid="${escapeHtml(a.id)}" aria-label="Удалить счёт">×</button>
      </div>
    `).join('');
    els.finAccountsList.querySelectorAll('.fin-del-btn[data-delaccid]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Удалить счёт? Если есть операции — счёт переедет в архив.')) return;
        const r = await finApi('DELETE', `/accounts/${btn.dataset.delaccid}`);
        if (!r.ok) { toast('Ошибка: ' + (r.data?.error || r.status)); return; }
        await renderFinanceView();
      });
    });
  }

  function renderFinOps() {
    if (els.finOpsCounter) els.finOpsCounter.textContent = String(cachedFinOps.length);
    if (!els.finOpsList) return;
    if (cachedFinOps.length === 0) {
      els.finOpsList.innerHTML = '<div class="empty">Операций пока нет.</div>';
      return;
    }
    els.finOpsList.innerHTML = cachedFinOps.map((o) => `
      <div class="row-item">
        <div class="row-main">
          <div class="row-name">${escapeHtml(opLabel(o))}</div>
          <div class="row-meta">${escapeHtml(o.op_date.slice(0, 10))} · ${escapeHtml(o.account_name || '—')}${o.counterparty_name ? ' · ' + escapeHtml(o.counterparty_name) : ''}${o.note ? ' · ' + escapeHtml(o.note) : ''}</div>
        </div>
        <div class="row-stat ${opCls(o.kind)}">${opSign(o.kind)} ${formatPrice(o.amount)}</div>
      </div>
    `).join('');
  }

  // ===== Finance Categories tab =====
  const FIN_CAT_KIND_LABELS = { income: 'Доход', expense: 'Расход' };

  async function renderFinCategories() {
    const [rIn, rEx] = await Promise.all([
      finApi('GET', '/categories?kind=income'),
      finApi('GET', '/categories?kind=expense'),
    ]);
    if (rIn.ok) cachedFinCategories.income = rIn.data?.items || [];
    if (rEx.ok) cachedFinCategories.expense = rEx.data?.items || [];

    function renderList(listEl, items, kind) {
      if (!listEl) return;
      if (!items.length) {
        listEl.innerHTML = '<div class="empty" style="padding:12px 16px">Нет статей. Добавьте первую.</div>';
        return;
      }
      listEl.innerHTML = items.map((c) => `
        <div class="row-item fin-cat-row" data-id="${escapeHtml(c.id)}" data-kind="${kind}">
          <div class="row-main"><div class="row-name">${escapeHtml(c.name)}</div></div>
          <button type="button" class="btn-ghost btn-sm fin-cat-del" data-id="${escapeHtml(c.id)}" data-kind="${kind}" aria-label="Удалить">✕</button>
        </div>
      `).join('');
      listEl.querySelectorAll('.fin-cat-del').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!confirm(`Удалить статью "${items.find((x) => x.id === btn.dataset.id)?.name}"?`)) return;
          const r = await finApi('DELETE', `/categories/${btn.dataset.id}`);
          if (!r.ok) { toast('Ошибка: ' + (r.data?.error || r.status)); return; }
          cachedFinCategories[btn.dataset.kind] = cachedFinCategories[btn.dataset.kind].filter((x) => x.id !== btn.dataset.id);
          renderList(listEl, cachedFinCategories[btn.dataset.kind], kind);
        });
      });
    }

    renderList(els.finCatIncomeList, cachedFinCategories.income, 'income');
    renderList(els.finCatExpenseList, cachedFinCategories.expense, 'expense');
  }

  function finCatWireAddForm(formEl, nameEl, cancelBtn, addBtn, kind, listElKey) {
    if (!formEl) return;
    addBtn?.addEventListener('click', () => { formEl.hidden = false; nameEl?.focus(); });
    cancelBtn?.addEventListener('click', () => { formEl.hidden = true; formEl.reset(); });
    formEl.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = nameEl?.value.trim();
      if (!name) return;
      const r = await finApi('POST', '/categories', { name, kind });
      if (!r.ok) { toast('Ошибка: ' + (r.data?.error || r.status)); return; }
      cachedFinCategories[kind] = [...cachedFinCategories[kind], r.data];
      formEl.hidden = true;
      formEl.reset();
      const listEl = els[listElKey];
      if (listEl) {
        function renderListInline(items) {
          listEl.innerHTML = items.map((c) => `
            <div class="row-item fin-cat-row" data-id="${escapeHtml(c.id)}" data-kind="${kind}">
              <div class="row-main"><div class="row-name">${escapeHtml(c.name)}</div></div>
              <button type="button" class="btn-ghost btn-sm fin-cat-del" data-id="${escapeHtml(c.id)}" data-kind="${kind}" aria-label="Удалить">✕</button>
            </div>
          `).join('');
          listEl.querySelectorAll('.fin-cat-del').forEach((btn) => {
            btn.addEventListener('click', async () => {
              if (!confirm(`Удалить статью "${items.find((x) => x.id === btn.dataset.id)?.name}"?`)) return;
              const res = await finApi('DELETE', `/categories/${btn.dataset.id}`);
              if (!res.ok) { toast('Ошибка: ' + (res.data?.error || res.status)); return; }
              cachedFinCategories[kind] = cachedFinCategories[kind].filter((x) => x.id !== btn.dataset.id);
              renderListInline(cachedFinCategories[kind]);
            });
          });
        }
        renderListInline(cachedFinCategories[kind]);
      }
    });
  }

  finCatWireAddForm(els.finCatIncomeForm, els.finCatIncomeName, els.finCatIncomeCancel, els.finCatAddIncomeBtn, 'income', 'finCatIncomeList');
  finCatWireAddForm(els.finCatExpenseForm, els.finCatExpenseName, els.finCatExpenseCancel, els.finCatAddExpenseBtn, 'expense', 'finCatExpenseList');

  // ===== Finance Counterparties tab =====
  const FIN_CPARTY_KIND_LABELS = { supplier: 'Поставщик', customer: 'Клиент', employee: 'Сотрудник', other: 'Другое' };

  async function renderFinCounterparties() {
    const r = await finApi('GET', '/counterparties');
    if (r.ok) cachedFinCounterparties = r.data?.items || [];
    if (els.finCpartyCounter) els.finCpartyCounter.textContent = String(cachedFinCounterparties.length);
    if (!els.finCpartyList) return;
    if (!cachedFinCounterparties.length) {
      els.finCpartyList.innerHTML = '<div class="empty">Нет контрагентов.</div>';
      return;
    }
    els.finCpartyList.innerHTML = cachedFinCounterparties.map((c) => `
      <div class="row-item">
        <div class="row-main">
          <div class="row-name">${escapeHtml(c.name)}${!c.is_active ? ' <span class="badge-muted">неактивен</span>' : ''}</div>
          <div class="row-meta">${escapeHtml(FIN_CPARTY_KIND_LABELS[c.kind] || c.kind)}${c.phone ? ' · ' + escapeHtml(c.phone) : ''}${c.inn ? ' · ИНН ' + escapeHtml(c.inn) : ''}</div>
        </div>
        <div class="row-actions">
          <button type="button" class="btn-ghost btn-sm" data-cparty-edit="${escapeHtml(c.id)}">✎</button>
          <button type="button" class="btn-ghost btn-sm" data-cparty-del="${escapeHtml(c.id)}">✕</button>
        </div>
      </div>
    `).join('');
    els.finCpartyList.querySelectorAll('[data-cparty-edit]').forEach((btn) =>
      btn.addEventListener('click', () => openCpartyModal(btn.dataset.cpartyEdit)));
    els.finCpartyList.querySelectorAll('[data-cparty-del]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const c = cachedFinCounterparties.find((x) => x.id === btn.dataset.cpartyDel);
        if (!confirm(`Деактивировать контрагента "${c?.name}"?`)) return;
        const res = await finApi('DELETE', `/counterparties/${btn.dataset.cpartyDel}`);
        if (!res.ok) { toast('Ошибка: ' + (res.data?.error || res.status)); return; }
        await renderFinCounterparties();
      }));
  }

  function openCpartyModal(id) {
    const c = id ? cachedFinCounterparties.find((x) => x.id === id) : null;
    if (els.finCpartyId) els.finCpartyId.value = id || '';
    if (els.finCpartyModalTitle) els.finCpartyModalTitle.textContent = c ? 'Редактировать контрагента' : 'Новый контрагент';
    if (els.finCpartyForm) els.finCpartyForm.reset();
    if (c) {
      if (els.finCpartyName) els.finCpartyName.value = c.name || '';
      if (els.finCpartyKind) els.finCpartyKind.value = c.kind || 'other';
      if (els.finCpartyInn) els.finCpartyInn.value = c.inn || '';
      if (els.finCpartyPhone) els.finCpartyPhone.value = c.phone || '';
      if (els.finCpartyEmail) els.finCpartyEmail.value = c.email || '';
      if (els.finCpartyNotes) els.finCpartyNotes.value = c.notes || '';
    }
    if (els.finCpartyBackdrop) els.finCpartyBackdrop.hidden = false;
    if (els.finCpartyModal) {
      els.finCpartyModal.hidden = false;
      els.finCpartyName?.focus();
    }
  }

  function closeCpartyModal() {
    if (els.finCpartyBackdrop) els.finCpartyBackdrop.hidden = true;
    if (els.finCpartyModal) els.finCpartyModal.hidden = true;
    if (els.finCpartyForm) els.finCpartyForm.reset();
  }

  els.finCpartyAddBtn?.addEventListener('click', () => openCpartyModal(null));
  els.finCpartyClose?.addEventListener('click', closeCpartyModal);
  els.finCpartyCancel?.addEventListener('click', closeCpartyModal);
  els.finCpartyBackdrop?.addEventListener('click', closeCpartyModal);

  els.finCpartyForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = els.finCpartyId?.value;
    const body = {
      name: els.finCpartyName?.value.trim(),
      kind: els.finCpartyKind?.value || 'other',
      inn: els.finCpartyInn?.value.trim() || undefined,
      phone: els.finCpartyPhone?.value.trim() || undefined,
      email: els.finCpartyEmail?.value.trim() || undefined,
      notes: els.finCpartyNotes?.value.trim() || undefined,
    };
    const r = id
      ? await finApi('PATCH', `/counterparties/${id}`, body)
      : await finApi('POST', '/counterparties', body);
    if (!r.ok) { toast('Ошибка: ' + (r.data?.error || r.status)); return; }
    closeCpartyModal();
    await renderFinCounterparties();
  });

  async function finPopulateCounterpartySelects() {
    if (!cachedFinCounterparties.length) {
      const r = await finApi('GET', '/counterparties');
      if (r.ok) cachedFinCounterparties = r.data?.items || [];
    }
    const opts = '<option value="">— не указан —</option>'
      + cachedFinCounterparties.filter((c) => c.is_active).map((c) =>
        `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('');
    if (els.finIncomeCparty) els.finIncomeCparty.innerHTML = opts;
    if (els.finExpenseCparty) els.finExpenseCparty.innerHTML = opts;
  }

  // ===== GIFT CERTIFICATES =====
  const CERT_STATUS_LABELS = { active: 'Активен', used: 'Использован', expired: 'Истёк', cancelled: 'Аннулирован' };
  let _certCurrentId = null;

  async function renderCertificates() {
    const status = document.getElementById('certStatusFilter')?.value || 'active';
    const { ok, data } = await finApi('GET', `/certificates?status=${status}`);
    const items = ok ? (data?.items || []) : [];
    const counterEl = document.getElementById('certCounter');
    if (counterEl) counterEl.textContent = String(items.length);
    const list = document.getElementById('certList');
    if (!list) return;
    if (!items.length) {
      list.innerHTML = '<div class="empty">Сертификатов нет</div>';
      return;
    }
    list.innerHTML = items.map((c) => {
      const statusCls = c.status === 'active' ? 'badge-green' : c.status === 'used' ? 'badge-gray' : 'badge-red';
      const pct = Math.round((c.balance / c.amount) * 100);
      const exp = c.expires_at ? ` · до ${c.expires_at.slice(0,10)}` : '';
      return `<div class="row-item" style="gap:12px;">
        <div style="flex:1;">
          <div class="row-name" style="font-family:monospace;font-size:15px;font-weight:800;letter-spacing:.06em;">${escapeHtml(c.code)}</div>
          <div class="row-meta">${c.client_name ? escapeHtml(c.client_name) + ' · ' : ''}${fmtMoney(c.balance)} из ${fmtMoney(c.amount)}${exp}</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <div style="width:60px;height:6px;border-radius:3px;background:var(--border);">
            <div style="width:${pct}%;height:100%;border-radius:3px;background:var(--primary);"></div>
          </div>
          <span class="badge ${statusCls}">${CERT_STATUS_LABELS[c.status]||c.status}</span>
          ${c.status === 'active' ? `<button type="button" class="btn-ghost btn-xs cert-cancel-btn" data-cert-id="${c.id}">×</button>` : ''}
        </div>
      </div>`;
    }).join('');
    list.querySelectorAll('.cert-cancel-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Аннулировать сертификат?')) return;
        await finApi('PATCH', `/certificates/${btn.dataset.certId}/cancel`);
        await renderCertificates();
      });
    });
  }

  function openCertModal() {
    document.getElementById('certForm').reset();
    document.getElementById('certForm').hidden = false;
    document.getElementById('certResult').hidden = true;
    document.getElementById('certFormError').hidden = true;
    document.getElementById('certModalBackdrop').hidden = false;
    document.getElementById('certModal').hidden = false;
    document.getElementById('certAmount')?.focus();
  }

  function closeCertModal() {
    document.getElementById('certModalBackdrop').hidden = true;
    document.getElementById('certModal').hidden = true;
  }

  document.getElementById('certAddBtn')?.addEventListener('click', openCertModal);
  document.getElementById('certModalClose')?.addEventListener('click', closeCertModal);
  document.getElementById('certModalCancel')?.addEventListener('click', closeCertModal);
  document.getElementById('certModalBackdrop')?.addEventListener('click', closeCertModal);
  document.getElementById('certStatusFilter')?.addEventListener('change', () => void renderCertificates());

  document.getElementById('certForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('certFormError');
    errEl.hidden = true;
    const btn = document.getElementById('certSubmitBtn');
    btn.disabled = true; btn.textContent = 'Оформляем…';

    const fd = new FormData(e.target);
    const payload = {
      amount: parseFloat(fd.get('amount')),
      client_name: fd.get('client_name')?.trim() || null,
      expires_at: fd.get('expires_at') || null,
      notes: fd.get('notes')?.trim() || null,
    };

    const { ok, data } = await finApi('POST', '/certificates', payload);
    btn.disabled = false; btn.textContent = 'Продать';

    if (!ok) {
      errEl.textContent = data?.error || 'Ошибка создания сертификата';
      errEl.hidden = false;
      return;
    }

    document.getElementById('certForm').hidden = true;
    const resultEl = document.getElementById('certResult');
    resultEl.hidden = false;
    document.getElementById('certResultCode').textContent = data.code;
    const exp = data.expires_at ? ` · действует до ${data.expires_at}` : '';
    document.getElementById('certResultInfo').textContent = `Номинал: ${fmtMoney(data.amount)}${exp}`;

    document.getElementById('certResultCopy').onclick = () => {
      navigator.clipboard.writeText(data.code).catch(() => {});
      document.getElementById('certResultCopy').textContent = 'Скопировано ✓';
    };
    document.getElementById('certResultClose').onclick = () => {
      closeCertModal();
      void renderCertificates();
    };
  });

  // ── Certificate in sale modal ──
  let _saleCertId = null;
  let _saleCertBalance = 0;
  let _saleCertSpend = 0;

  document.getElementById('saleCertApply')?.addEventListener('click', async () => {
    const code = (document.getElementById('saleCertCode')?.value || '').trim().toUpperCase();
    const msg = document.getElementById('saleCertMsg');
    msg.textContent = '';
    msg.style.color = 'var(--text-dim)';
    if (!code) return;
    msg.textContent = 'Проверяем…';
    const { ok, data } = await finApi('GET', `/certificates/check?code=${encodeURIComponent(code)}`);
    if (!ok) {
      _saleCertId = null; _saleCertBalance = 0;
      msg.style.color = 'var(--danger)';
      msg.textContent = data?.message || 'Сертификат не найден';
      updateSaleTotal();
      return;
    }
    _saleCertId = data.id;
    _saleCertBalance = Number(data.balance) || 0;
    msg.style.color = 'var(--success)';
    msg.textContent = `✓ Баланс: ${fmtMoney(_saleCertBalance)}`;
    updateSaleTotal();
  });

  // Reset cert state when sale modal opens/closes
  const _origOpenSaleModal = openSaleModal;
  openSaleModal = async function(...args) {
    _saleCertId = null; _saleCertBalance = 0; _saleCertSpend = 0;
    const codeEl = document.getElementById('saleCertCode');
    const msgEl = document.getElementById('saleCertMsg');
    if (codeEl) codeEl.value = '';
    if (msgEl) msgEl.textContent = '';
    return _origOpenSaleModal(...args);
  };

  async function openFinModal(backdrop, modal, setupFn) {
    finPopulateAccountSelects();
    await finPopulateCounterpartySelects();
    if (setupFn) await setupFn();
    backdrop.hidden = false;
    modal.hidden = false;
    const firstInput = modal.querySelector('input:not([type=hidden]), select');
    if (firstInput) firstInput.focus();
  }
  function closeFinModal(backdrop, modal, form) {
    backdrop.hidden = true;
    modal.hidden = true;
    if (form) form.reset();
  }

  // Finance sub-nav clicks
  if (els.financeSubnav) {
    els.financeSubnav.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-fin-tab]');
      if (!btn) return;
      financeTab = btn.dataset.finTab;
      void renderFinanceView();
    });
  }

  // Period pills (Сегодня / Вчера / Неделя / Месяц / Год)
  document.querySelectorAll('#finPeriodBar .fin-period-pill').forEach((b) => {
    b.addEventListener('click', () => {
      finPeriod = b.dataset.finPeriod;
      localStorage.setItem('fin_period', finPeriod);
      document.querySelectorAll('#finPeriodBar .fin-period-pill').forEach((x) => {
        x.classList.toggle('active', x.dataset.finPeriod === finPeriod);
      });
      void renderFinanceView();
    });
  });
  // отметить активный pill при загрузке
  document.querySelectorAll('#finPeriodBar .fin-period-pill').forEach((x) => {
    x.classList.toggle('active', x.dataset.finPeriod === finPeriod);
  });

  // Filter drawer toggle
  document.getElementById('finFiltersBtn')?.addEventListener('click', () => {
    const drawer = document.getElementById('finFiltersDrawer');
    if (drawer) drawer.hidden = !drawer.hidden;
  });

  // Filter changes
  ['finFilterAccount', 'finFilterCategory', 'finFilterKind', 'finFilterMethod'].forEach((id) => {
    document.getElementById(id)?.addEventListener('change', (e) => {
      const key = id === 'finFilterAccount' ? 'account_id'
        : id === 'finFilterCategory' ? 'category_id'
          : id === 'finFilterMethod' ? 'payment_method' : 'kind';
      finFilters[key] = e.target.value;
      void renderFinanceView();
    });
  });
  document.getElementById('finFiltersReset')?.addEventListener('click', () => {
    finFilters.account_id = ''; finFilters.category_id = ''; finFilters.kind = ''; finFilters.payment_method = '';
    ['finFilterAccount', 'finFilterCategory', 'finFilterKind', 'finFilterMethod'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    void renderFinanceView();
  });

  // Заполняет dropdown'ы фильтров текущими счетами и категориями.
  function finUpdateFilterDropdowns() {
    const accSel = document.getElementById('finFilterAccount');
    if (accSel) {
      const cur = accSel.value;
      accSel.innerHTML = '<option value="">Все счета</option>'
        + cachedFinAccounts.map((a) => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)}</option>`).join('');
      accSel.value = cur;
    }
    const catSel = document.getElementById('finFilterCategory');
    if (catSel) {
      const cur = catSel.value;
      const allCats = [...(cachedFinCategories.income || []), ...(cachedFinCategories.expense || [])];
      catSel.innerHTML = '<option value="">Все статьи</option>'
        + allCats.map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)} (${c.kind === 'income' ? '+' : '−'})</option>`).join('');
      catSel.value = cur;
    }
  }

  // + Доход button
  if (els.finAddIncomeBtn) {
    els.finAddIncomeBtn.addEventListener('click', () => {
      void openFinModal(els.finIncomeBackdrop, els.finIncomeModal, async () => {
        if (!els.finIncomeDate.value) els.finIncomeDate.value = todayLocalISO();
        await finPopulateCategorySelect(els.finIncomeCategory, 'income');
      });
    });
  }
  if (els.finIncomeClose) els.finIncomeClose.addEventListener('click', () => closeFinModal(els.finIncomeBackdrop, els.finIncomeModal, els.finIncomeForm));
  if (els.finIncomeCancel) els.finIncomeCancel.addEventListener('click', () => closeFinModal(els.finIncomeBackdrop, els.finIncomeModal, els.finIncomeForm));
  if (els.finIncomeBackdrop) els.finIncomeBackdrop.addEventListener('click', () => closeFinModal(els.finIncomeBackdrop, els.finIncomeModal, els.finIncomeForm));
  if (els.finIncomeForm) {
    els.finIncomeForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const r = await finApi('POST', '/operations/income', {
        account_id: els.finIncomeAccount.value,
        amount: parseFloat(els.finIncomeAmount.value) || 0,
        op_date: els.finIncomeDate.value,
        category_id: els.finIncomeCategory.value || undefined,
        counterparty_id: els.finIncomeCparty?.value || undefined,
        note: els.finIncomeNote.value.trim() || undefined,
      });
      if (!r.ok) { toast('Ошибка: ' + (r.data?.error || r.status)); return; }
      closeFinModal(els.finIncomeBackdrop, els.finIncomeModal, els.finIncomeForm);
      await renderFinanceView();
    });
  }

  // + Расход button
  if (els.finAddExpenseBtn) {
    els.finAddExpenseBtn.addEventListener('click', () => {
      void openFinModal(els.finExpenseBackdrop, els.finExpenseModal, async () => {
        if (!els.finExpenseDate.value) els.finExpenseDate.value = todayLocalISO();
        await finPopulateCategorySelect(els.finExpenseCategory, 'expense');
      });
    });
  }
  if (els.finExpenseClose) els.finExpenseClose.addEventListener('click', () => closeFinModal(els.finExpenseBackdrop, els.finExpenseModal, els.finExpenseForm));
  if (els.finExpenseCancel) els.finExpenseCancel.addEventListener('click', () => closeFinModal(els.finExpenseBackdrop, els.finExpenseModal, els.finExpenseForm));
  if (els.finExpenseBackdrop) els.finExpenseBackdrop.addEventListener('click', () => closeFinModal(els.finExpenseBackdrop, els.finExpenseModal, els.finExpenseForm));
  if (els.finExpenseForm) {
    els.finExpenseForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const r = await finApi('POST', '/operations/expense', {
        account_id: els.finExpenseAccount.value,
        amount: parseFloat(els.finExpenseAmount.value) || 0,
        op_date: els.finExpenseDate.value,
        category_id: els.finExpenseCategory.value || undefined,
        counterparty_id: els.finExpenseCparty?.value || undefined,
        note: els.finExpenseNote.value.trim() || undefined,
      });
      if (!r.ok) { toast('Ошибка: ' + (r.data?.error || r.status)); return; }
      closeFinModal(els.finExpenseBackdrop, els.finExpenseModal, els.finExpenseForm);
      await renderFinanceView();
    });
  }

  // Перемещение button
  if (els.finTransferBtn) {
    els.finTransferBtn.addEventListener('click', () => {
      void openFinModal(els.finTransferBackdrop, els.finTransferModal, async () => {
        if (!els.finTransferDate.value) els.finTransferDate.value = todayLocalISO();
      });
    });
  }
  if (els.finTransferClose) els.finTransferClose.addEventListener('click', () => closeFinModal(els.finTransferBackdrop, els.finTransferModal, els.finTransferForm));
  if (els.finTransferCancel) els.finTransferCancel.addEventListener('click', () => closeFinModal(els.finTransferBackdrop, els.finTransferModal, els.finTransferForm));
  if (els.finTransferBackdrop) els.finTransferBackdrop.addEventListener('click', () => closeFinModal(els.finTransferBackdrop, els.finTransferModal, els.finTransferForm));
  if (els.finTransferForm) {
    els.finTransferForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fromId = els.finTransferFrom.value;
      const toId = els.finTransferTo.value;
      if (fromId === toId) { toast('Выберите разные счета.'); return; }
      const r = await finApi('POST', '/operations/transfer', {
        from_account_id: fromId,
        to_account_id: toId,
        amount: parseFloat(els.finTransferAmount.value) || 0,
        op_date: els.finTransferDate.value,
        note: els.finTransferNote.value.trim() || undefined,
      });
      if (!r.ok) { toast('Ошибка: ' + (r.data?.error || r.status)); return; }
      closeFinModal(els.finTransferBackdrop, els.finTransferModal, els.finTransferForm);
      await renderFinanceView();
    });
  }

  // + Счёт button
  if (els.finAddAccountBtn) {
    els.finAddAccountBtn.addEventListener('click', () => {
      void openFinModal(els.finAccountBackdrop, els.finAccountModal, null);
    });
  }
  if (els.finAccountClose) els.finAccountClose.addEventListener('click', () => closeFinModal(els.finAccountBackdrop, els.finAccountModal, els.finAccountForm));
  if (els.finAccountCancel) els.finAccountCancel.addEventListener('click', () => closeFinModal(els.finAccountBackdrop, els.finAccountModal, els.finAccountForm));
  if (els.finAccountBackdrop) els.finAccountBackdrop.addEventListener('click', () => closeFinModal(els.finAccountBackdrop, els.finAccountModal, els.finAccountForm));
  if (els.finAccountForm) {
    els.finAccountForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = els.finAccountName.value.trim();
      if (!name) return;
      const r = await finApi('POST', '/accounts', {
        name,
        type: 'cash',
        initial_balance: parseFloat(els.finAccountInitBal.value) || 0,
      });
      if (!r.ok) { toast('Ошибка: ' + (r.data?.error || r.status)); return; }
      closeFinModal(els.finAccountBackdrop, els.finAccountModal, els.finAccountForm);
      await renderFinanceView();
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (els.finIncomeModal && !els.finIncomeModal.hidden) closeFinModal(els.finIncomeBackdrop, els.finIncomeModal, els.finIncomeForm);
    if (els.finExpenseModal && !els.finExpenseModal.hidden) closeFinModal(els.finExpenseBackdrop, els.finExpenseModal, els.finExpenseForm);
    if (els.finTransferModal && !els.finTransferModal.hidden) closeFinModal(els.finTransferBackdrop, els.finTransferModal, els.finTransferForm);
    if (els.finAccountModal && !els.finAccountModal.hidden) closeFinModal(els.finAccountBackdrop, els.finAccountModal, els.finAccountForm);
  });

  // ============================================================ *
  // SALARY (Sprint 1) — Tab 1 (Расчёт), Tab 4 (Схемы), 2 модалки.  *
  // Backend ещё нет; источник — cachedMasters + localStorage схемы. *
  // ============================================================ */
  const SAL_LS_SCHEMES = 'samaya_salary_schemes_v1';
  const SAL_LS_PERIOD = 'samaya_salary_period';
  const SAL_SCHEME_LABELS = {
    rate: 'Ставка',
    rate_plus_percent: 'Ставка + % с продаж (- скидка)',
    percent_only: '% с продаж',
  };

  let salPeriod = localStorage.getItem(SAL_LS_PERIOD) || 'today';
  let salSchemes = [];
  let salActiveTab = 'payroll';
  let cachedSalCalc = null;       // {from, to, days, items: [{master_id, rate, pct_services, pct_salon, guaranteed, total}]}
  let cachedSalAccruals = [];     // [{id, master_id, amount, period_from, period_to, source_kind, source, note, created_at}]
  let cachedSalSettlements = [];  // [{master_id, master_name, accrued_total, paid_total, balance}]
  let cachedSalFinAccounts = [];  // accounts list for payout modal
  let salMigrationDone = false;

  async function salApi(method, path, body) {
    return apiCall(method, '/api/salary' + path, body);
  }

  // Загружает схемы с backend в кэш salSchemes (с нормализацией effective_from к YYYY-MM-DD).
  async function salLoadSchemes() {
    if (!store.access) { salSchemes = []; return; }
    const r = await salApi('GET', '/schemes');
    if (!r.ok) { salSchemes = []; return; }
    salSchemes = (r.data?.items || []).map((s) => ({
      ...s,
      effective_from: typeof s.effective_from === 'string' ? s.effective_from.slice(0, 10) : s.effective_from,
      effective_to: typeof s.effective_to === 'string' ? s.effective_to.slice(0, 10) : s.effective_to,
    }));
  }
  function salSaveSchemes() { /* no-op: persist через API */ }

  function salPeriodRange(period) {
    const now = new Date();
    const today = todayLocalISO();
    if (period === 'today') return { from: today, to: today, days: 1 };
    if (period === 'yesterday') {
      const y = new Date(now); y.setDate(y.getDate() - 1);
      const iso = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
      return { from: iso, to: iso, days: 1 };
    }
    if (period === 'week') {
      const start = new Date(now); start.setDate(start.getDate() - 6);
      const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      return { from: iso(start), to: today, days: 7 };
    }
    if (period === 'month') {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const days = now.getDate();
      return { from: iso(start), to: today, days };
    }
    return { from: today, to: today, days: 1 };
  }

  // Активная схема для мастера на дату (берём ту, у которой effective_from ≤ date и она самая свежая)
  function salActiveScheme(masterId, dateIso) {
    const list = salSchemes
      .filter((s) => s.master_id === masterId && s.effective_from <= dateIso)
      .sort((a, b) => b.effective_from.localeCompare(a.effective_from));
    return list[0] || null;
  }

  // Расчёт по схеме за период — читаем из API-кэша cachedSalCalc.
  // Backend (salary-service) уже учёл активную схему, продажи (completed bookings),
  // гарантированную сумму и rate-period нормализацию.
  function salCalcRow(master, range) {
    const empty = {
      rate: 0, percent_services: 0, percent_salon: 0, guaranteed: 0, total: 0,
      commission_total: 0, worked_days: null, is_cleaner: false, is_manager: false,
    };
    if (!cachedSalCalc || cachedSalCalc.from?.slice(0, 10) !== range.from || cachedSalCalc.to?.slice(0, 10) !== range.to) return empty;
    const item = cachedSalCalc.items?.find((x) => x.master_id === master.id);
    if (!item) return empty;
    return {
      rate: item.rate || 0,
      percent_services: item.pct_services || 0,
      percent_salon: item.pct_salon || 0,
      guaranteed: item.guaranteed || 0,
      commission_total: item.commission_total || 0,
      worked_days: item.worked_days ?? null,
      is_cleaner: !!item.is_cleaner,
      is_manager: !!item.is_manager,
      total: item.total || 0,
    };
  }

  async function salLoadCalc(range) {
    if (!store.access) { cachedSalCalc = null; return; }
    const r = await salApi('GET', `/calculate?from=${range.from}&to=${range.to}`);
    cachedSalCalc = r.ok ? r.data : null;
  }

  async function salLoadFinAccounts() {
    if (!store.access) { cachedSalFinAccounts = []; return; }
    const r = await apiCall('GET', '/api/finance/accounts');
    cachedSalFinAccounts = r.ok ? (r.data?.items || []).filter((a) => a.is_active) : [];
  }

  // ----- Migration of localStorage salary data → backend -----
  async function migrateLocalStorageSalary() {
    if (salMigrationDone) return;
    salMigrationDone = true;
    const lsSchemes = (() => { try { return JSON.parse(localStorage.getItem(SAL_LS_SCHEMES) || '[]'); } catch { return []; } })();
    const lsAccruals = (() => { try { return JSON.parse(localStorage.getItem(SAL_LS_ACCRUALS) || '[]'); } catch { return []; } })();
    if (!lsSchemes.length && !lsAccruals.length) return;
    if (salSchemes.length > 0 || cachedSalAccruals.length > 0) {
      // backend уже не пуст — чистим LS
      localStorage.removeItem(SAL_LS_SCHEMES);
      localStorage.removeItem(SAL_LS_ACCRUALS);
      return;
    }
    if (!confirm(`Найдены сохранённые в браузере данные зарплаты: ${lsSchemes.length} схем(ы), ${lsAccruals.length} начислений. Перенести на сервер?`)) {
      return;
    }
    let okSchemes = 0, failSchemes = 0;
    for (const s of lsSchemes) {
      const r = await salApi('POST', '/schemes', {
        master_id: s.master_id,
        scheme_type: s.scheme_type,
        rate_amount: Number(s.rate_amount) || 0,
        rate_period: s.rate_period || 'month',
        percent_services: Number(s.percent_services) || 0,
        percent_goods: Number(s.percent_goods) || 0,
        apply_discount: !!s.apply_discount,
        guaranteed: Number(s.guaranteed) || 0,
        effective_from: s.effective_from || todayLocalISO(),
        notes: s.notes || undefined,
      });
      if (r.ok) okSchemes++; else failSchemes++;
    }
    let okAcc = 0, failAcc = 0;
    for (const a of lsAccruals) {
      const sourceKind = a.type === 'penalty' ? 'penalty' : a.type === 'bonus' ? 'bonus' : a.type === 'payout' ? 'manual' : 'auto_calc';
      const signedAmount = (a.type === 'penalty' || a.type === 'payout') ? -Math.abs(Number(a.amount) || 0) : Math.abs(Number(a.amount) || 0);
      const r = await salApi('POST', '/accruals', {
        master_id: a.master_id,
        amount: signedAmount,
        source_kind: sourceKind,
        source: a.source || a.reason || undefined,
        period_from: a.period_from || undefined,
        period_to: a.period_to || undefined,
        note: a.reason || undefined,
      });
      if (r.ok) okAcc++; else failAcc++;
    }
    if (failSchemes === 0 && failAcc === 0) {
      localStorage.removeItem(SAL_LS_SCHEMES);
      localStorage.removeItem(SAL_LS_ACCRUALS);
      toast(`Перенесено: ${okSchemes} схем(ы), ${okAcc} начислений. Локальные данные удалены.`);
    } else {
      toast(`Перенесено схем ${okSchemes}/${okSchemes + failSchemes}, начислений ${okAcc}/${okAcc + failAcc}. Локальные данные оставлены.`);
    }
    await salLoadSchemes();
  }

  // ----- View activation -----
  async function activateSalaryView() {
    if (!cachedMasters.length) await loadMasters();
    await Promise.all([
      salLoadSchemes(),
      salLoadAccrualsApi(),
      salLoadFinAccounts(),
      salLoadSettlements(),
      salLoadCommissions(),
      salLoadStaffGroups(),
      // Категории нужны для правил «процент с группы услуг» — без них
      // выпадающий список групп услуг оказался бы пустым.
      loadServiceCategories(),
    ]);
    await salLoadCalc(salPeriodRange(salPeriod));
    await migrateLocalStorageSalary();
    salPopulateMasterSelects();
    renderSalary();
  }

  function salPopulateMasterSelects() {
    const opts = '<option value="">Все сотрудники</option>' +
      cachedMasters.filter((m) => m.is_active).map((m) =>
        `<option value="${m.id}">${escapeHtml(m.display_name || '—')}</option>`).join('');
    const sel1 = document.getElementById('salPayrollMaster');
    const sel2 = document.getElementById('salSchemesMaster');
    const sel3 = document.getElementById('salSchemeMaster'); // в модалке
    if (sel1) sel1.innerHTML = opts;
    if (sel2) sel2.innerHTML = opts;
    if (sel3) sel3.innerHTML = '<option value="">— выберите —</option>' +
      cachedMasters.filter((m) => m.is_active).map((m) =>
        `<option value="${m.id}">${escapeHtml(m.display_name || '—')}</option>`).join('');
  }

  function salSwitchTab(tab) {
    salActiveTab = tab;
    document.querySelectorAll('#salarySubnav .subnav-item').forEach((b) => {
      b.classList.toggle('active', b.dataset.salTab === tab);
    });
    ['payroll', 'settlements', 'accruals', 'schemes', 'commissions'].forEach((k) => {
      const el = document.getElementById('salTab' + k.charAt(0).toUpperCase() + k.slice(1));
      if (el) el.hidden = (k !== tab);
    });
    renderSalary();
  }

  function renderSalary() {
    if (salActiveTab === 'payroll') renderSalaryPayroll();
    if (salActiveTab === 'schemes') renderSalarySchemes();
    if (salActiveTab === 'commissions') { renderSalaryCommissions(); renderStaffGroups(); }
  }

  // ----- Tab 1: Payroll -----
  function renderSalaryPayroll() {
    const list = document.getElementById('salPayrollList');
    if (!list) return;
    const filter = document.getElementById('salPayrollMaster')?.value || '';
    const range = salPeriodRange(salPeriod);
    let masters = cachedMasters.filter((m) => m.is_active);
    if (filter) masters = masters.filter((m) => m.id === filter);

    if (masters.length === 0) {
      list.innerHTML = '<div class="empty">Нет активных сотрудников. Добавьте сотрудника в разделе «Сотрудники», затем создайте схему расчёта.</div>';
      const totalEl = document.getElementById('salPayrollTotal');
      if (totalEl) totalEl.textContent = '0 ₽';
      const nEl = document.getElementById('salPayrollMastersN');
      if (nEl) nEl.textContent = '0 сотрудников';
      return;
    }

    const rows = masters.map((m) => ({ master: m, calc: salCalcRow(m, range) }));
    rows.sort((a, b) => b.calc.total - a.calc.total);

    const sum = rows.reduce((acc, r) => ({
      rate: acc.rate + r.calc.rate,
      percent_services: acc.percent_services + r.calc.percent_services,
      percent_salon: acc.percent_salon + r.calc.percent_salon,
      guaranteed: acc.guaranteed + r.calc.guaranteed,
      total: acc.total + r.calc.total,
    }), { rate: 0, percent_services: 0, percent_salon: 0, guaranteed: 0, total: 0 });

    const fmtCell = (v, label = '') => v > 0
      ? `<div class="sg-col sg-col-num" data-label="${label}">${fmtMoney(v)}</div>`
      : `<div class="sg-col sg-col-num empty-val" data-label="${label}">—</div>`;

    const summary = `
      <div class="sal-row summary">
        <div class="sg-col sg-col-master"><b>Итого</b></div>
        ${fmtCell(sum.percent_services, '% с продаж')}
        ${fmtCell(sum.percent_salon, '% с продаж салона')}
        ${fmtCell(sum.rate, 'Оклад / Повременная')}
        ${fmtCell(sum.guaranteed, 'Гарантированная')}
        <div class="sg-col sg-col-num sg-col-total" data-label="К начислению">${fmtMoney(sum.total)}</div>
      </div>
    `;

    const body = rows.map(({ master, calc }) => {
      const initials = (master.display_name || '?').split(' ').map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
      const roleLabel = master.provides_services === false
        ? (master.position || master.specialization || (calc.is_cleaner ? 'Техничка' : 'Менеджер'))
        : (master.specialization || '');
      const isCleaner = calc.is_cleaner;
      const isManager = calc.is_manager;
      return `
        <div class="sal-row${isCleaner ? ' sal-row-cleaner' : isManager ? ' sal-row-manager' : ''}" data-master-id="${master.id}">
          <div class="sg-col sg-col-master">
            <div class="sal-master-cell">
              <div class="user-avatar small" style="background:${stringToColor(master.id)}">${escapeHtml(initials || '?')}</div>
              <div class="sal-master-info">
                <div class="sal-master-name">${escapeHtml(master.display_name || '—')}</div>
                <div class="sal-master-role">${escapeHtml(roleLabel)}</div>
              </div>
            </div>
          </div>
          ${isCleaner
            ? `${fmtCell(calc.worked_days != null ? calc.worked_days : 0, 'Смен')}
               <div class="sg-col sg-col-num empty-val" data-label="% с продаж">—</div>
               ${fmtCell(calc.rate, 'Оклад / Повременная')}
               ${fmtCell(calc.guaranteed, 'Гарантированная')}`
            : isManager
            ? `${fmtCell(calc.commission_total, 'Комиссии')}
               <div class="sg-col sg-col-num empty-val" data-label="% с продаж">—</div>
               ${fmtCell(calc.rate, 'Оклад / Повременная')}
               ${fmtCell(calc.guaranteed, 'Гарантированная')}`
            : `${fmtCell(calc.percent_services, '% с продаж')}
               ${fmtCell(calc.percent_salon, '% с продаж салона')}
               ${fmtCell(calc.rate, 'Оклад / Повременная')}
               ${fmtCell(calc.guaranteed, 'Гарантированная')}`
          }
          <div class="sg-col sg-col-num sg-col-total" data-label="К начислению">${fmtMoney(calc.total)}</div>
        </div>
      `;
    }).join('');

    list.innerHTML = summary + body;

    const totalEl = document.getElementById('salPayrollTotal');
    if (totalEl) totalEl.textContent = sum.total.toLocaleString('ru-RU') + ' ₽';
    const nEl = document.getElementById('salPayrollMastersN');
    if (nEl) nEl.textContent = `${rows.length} ${rows.length === 1 ? 'сотрудник' : (rows.length < 5 ? 'сотрудника' : 'сотрудников')}`;
  }

  // ----- Tab 4: Schemes -----
  function renderSalarySchemes() {
    const list = document.getElementById('salSchemesList');
    if (!list) return;
    const filter = document.getElementById('salSchemesMaster')?.value || '';
    let items = salSchemes.slice();
    if (filter) items = items.filter((s) => s.master_id === filter);
    items.sort((a, b) => b.effective_from.localeCompare(a.effective_from));

    if (items.length === 0) {
      list.innerHTML = '<div class="empty">Схем зарплаты пока нет. Кнопка «+ Добавить схему» — справа сверху.</div>';
      return;
    }

    const masterMap = new Map(cachedMasters.map((m) => [m.id, m.display_name || '—']));
    list.innerHTML = items.map((s) => {
      const masterName = masterMap.get(s.master_id) || '—';
      return `
        <div class="sal-row" data-scheme-id="${s.id}">
          <div class="sg-col sg-col-master">${escapeHtml(masterName)}</div>
          <div class="sg-col">${escapeHtml(SAL_SCHEME_LABELS[s.scheme_type] || s.scheme_type)}</div>
          <div class="sg-col sg-col-date">${escapeHtml(s.effective_from)}</div>
          <div class="sg-col sg-col-action">
            <button type="button" class="sal-row-action" data-act="dup" title="Дубликат">⧉</button>
          </div>
          <div class="sg-col sg-col-action">
            <button type="button" class="sal-row-action danger" data-act="del" title="Удалить">×</button>
          </div>
        </div>
      `;
    }).join('');

    list.querySelectorAll('[data-act]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.closest('.sal-row').dataset.schemeId;
        const act = btn.dataset.act;
        const s = salSchemes.find((x) => x.id === id);
        if (!s) return;
        if (act === 'dup') {
          const r = await salApi('POST', '/schemes', {
            master_id: s.master_id,
            scheme_type: s.scheme_type,
            rate_amount: Number(s.rate_amount) || 0,
            rate_period: s.rate_period || 'month',
            percent_services: Number(s.percent_services) || 0,
            percent_goods: Number(s.percent_goods) || 0,
            apply_discount: !!s.apply_discount,
            guaranteed: Number(s.guaranteed) || 0,
            effective_from: todayLocalISO(),
            notes: s.notes || undefined,
          });
          if (!r.ok) { toast('Ошибка: ' + (r.data?.error || r.status)); return; }
          await salLoadSchemes();
          await salLoadCalc(salPeriodRange(salPeriod));
          renderSalarySchemes();
        } else if (act === 'del') {
          if (!confirm('Удалить схему?')) return;
          const r = await salApi('DELETE', `/schemes/${id}`);
          if (!r.ok) { toast('Ошибка: ' + (r.data?.error || r.status)); return; }
          await salLoadSchemes();
          await salLoadCalc(salPeriodRange(salPeriod));
          renderSalarySchemes();
        }
      });
    });
  }

  // ----- Modal: salary_scheme_create -----
  function salOpenSchemeModal() {
    salPopulateMasterSelects();
    const today = todayLocalISO();
    const dateInp = document.getElementById('salSchemeStart');
    if (dateInp) dateInp.value = today;
    salUpdateSchemeFields();
    const back = document.getElementById('salSchemeModalBackdrop');
    if (back) back.hidden = false;
    const err = document.getElementById('salSchemeError');
    if (err) err.hidden = true;
  }
  function salCloseSchemeModal() {
    const back = document.getElementById('salSchemeModalBackdrop');
    if (back) back.hidden = true;
    const f = document.getElementById('salSchemeForm');
    if (f) f.reset();
  }
  function salUpdateSchemeFields() {
    const type = document.querySelector('input[name="scheme_type"]:checked')?.value || 'rate';
    const rateBlock = document.querySelector('.sal-rate-fields');
    const pctBlock = document.querySelector('.sal-percent-fields');
    if (rateBlock) rateBlock.hidden = !(type === 'rate' || type === 'rate_plus_percent');
    if (pctBlock) pctBlock.hidden = !(type === 'percent_only' || type === 'rate_plus_percent');
  }

  async function salSubmitScheme(e) {
    e.preventDefault();
    const f = e.target;
    const fd = new FormData(f);
    const master_id = String(fd.get('master_id') || '');
    const scheme_type = String(fd.get('scheme_type') || 'rate');
    const effective_from = String(fd.get('effective_from') || todayLocalISO());
    const err = document.getElementById('salSchemeError');
    if (!master_id) { err.textContent = 'Выберите сотрудника'; err.hidden = false; return; }

    const payload = {
      master_id, scheme_type, effective_from,
      rate_amount: Number(fd.get('rate_amount')) || 0,
      rate_period: String(fd.get('rate_period') || 'month'),
      percent_services: Number(fd.get('percent_services')) || 0,
      percent_goods: Number(fd.get('percent_goods')) || 0,
      apply_discount: !!fd.get('apply_discount'),
      guaranteed: Number(fd.get('guaranteed')) || 0,
      notes: String(fd.get('notes') || '') || undefined,
    };
    if (scheme_type === 'rate' && payload.rate_amount <= 0) {
      err.textContent = 'Укажите ставку больше 0'; err.hidden = false; return;
    }
    if (scheme_type === 'percent_only' && payload.percent_services <= 0) {
      err.textContent = 'Укажите % с продаж услуг больше 0'; err.hidden = false; return;
    }
    const r = await salApi('POST', '/schemes', payload);
    if (!r.ok) {
      err.textContent = 'Ошибка: ' + (r.data?.error || r.status);
      err.hidden = false;
      return;
    }
    salCloseSchemeModal();
    await salLoadSchemes();
    await salLoadCalc(salPeriodRange(salPeriod));
    salSwitchTab('schemes');
  }

  // ----- Modal: payroll_run -----
  function salOpenPayrollModal() {
    const range = salPeriodRange(salPeriod);
    const fromI = document.getElementById('salPayrollFrom');
    const toI = document.getElementById('salPayrollTo');
    if (fromI) fromI.value = range.from;
    if (toI) toI.value = range.to;
    salRebuildPayrollPreview();
    const back = document.getElementById('salPayrollModalBackdrop');
    if (back) back.hidden = false;
  }
  function salClosePayrollModal() {
    const back = document.getElementById('salPayrollModalBackdrop');
    if (back) back.hidden = true;
  }
  function salRebuildPayrollPreview() {
    const fromI = document.getElementById('salPayrollFrom');
    const toI = document.getElementById('salPayrollTo');
    if (!fromI || !toI) return;
    const from = fromI.value, to = toI.value;
    const days = Math.max(1, Math.round((new Date(to) - new Date(from)) / 86400000) + 1);
    const range = { from, to, days };
    const masters = cachedMasters.filter((m) => m.is_active);
    const rows = masters.map((m) => ({ master: m, calc: salCalcRow(m, range) }));
    let total = 0;
    const html = rows.map(({ master, calc }) => {
      total += calc.total;
      return `
        <div class="sal-payroll-pp-row">
          <input type="checkbox" data-master-id="${master.id}" ${calc.total > 0 ? 'checked' : ''} />
          <div>${escapeHtml(master.display_name || '—')}</div>
          <div class="sal-pp-amount">${fmtMoney(calc.total)} ₽</div>
        </div>
      `;
    }).join('');
    const list = document.getElementById('salPayrollPreview');
    if (list) list.innerHTML = html || '<div class="empty">Нет активных сотрудников.</div>';
    const totalEl = document.getElementById('salPayrollPreviewTotal');
    if (totalEl) totalEl.textContent = total.toLocaleString('ru-RU') + ' ₽';
    if (list) {
      list.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
        cb.addEventListener('change', () => {
          let t = 0;
          list.querySelectorAll('.sal-payroll-pp-row').forEach((row) => {
            const cb = row.querySelector('input');
            if (cb && cb.checked) {
              const txt = row.querySelector('.sal-pp-amount').textContent;
              t += Number(txt.replace(/[^\d]/g, '')) || 0;
            }
          });
          if (totalEl) totalEl.textContent = t.toLocaleString('ru-RU') + ' ₽';
        });
      });
    }
  }
  async function salSubmitPayroll(e) {
    e.preventDefault();
    const list = document.getElementById('salPayrollPreview');
    const checked = Array.from(list.querySelectorAll('input:checked')).map((c) => c.dataset.masterId);
    if (checked.length === 0) {
      const err = document.getElementById('salPayrollError');
      err.textContent = 'Выберите хотя бы одного сотрудника';
      err.hidden = false;
      return;
    }
    const range = {
      from: document.getElementById('salPayrollFrom').value,
      to: document.getElementById('salPayrollTo').value,
    };
    // calc для каждой выбранной мастера → загрузим свежий расчёт за указанный период
    await salLoadCalc(range);
    const items = checked
      .map((masterId) => {
        const m = cachedMasters.find((x) => x.id === masterId);
        if (!m) return null;
        const calc = salCalcRow(m, { ...range, days: Math.max(1, Math.round((new Date(range.to) - new Date(range.from)) / 86400000) + 1) });
        if (!calc.total || calc.total <= 0) return null;
        return {
          master_id: masterId,
          amount: calc.total,
          source_kind: 'auto_calc',
          source: `Расчёт ЗП ${range.from} — ${range.to}`,
          period_from: range.from,
          period_to: range.to,
        };
      })
      .filter(Boolean);
    if (!items.length) { toast('Нет начислений (у всех total = 0).'); return; }
    const r = await salApi('POST', '/accruals/bulk', { items });
    if (!r.ok) { toast('Ошибка: ' + (r.data?.error || r.status)); return; }
    salClosePayrollModal();
    await salLoadAccrualsApi();
    await salLoadSettlements();
    if (salActiveTab === 'accruals') renderSalaryAccruals();
    if (salActiveTab === 'settlements') renderSalarySettlements();
    toast(`Начислено для ${r.data?.count || items.length} сотрудника(ов).`);
  }

  // ----- Sprint 2: Accruals storage helpers -----
  const SAL_LS_ACCRUALS = 'samaya_salary_accruals_v1';
  const SAL_ACC_TYPE_LABELS = {
    accrual: 'Начисление',
    bonus: 'Премия',
    penalty: 'Штраф',
    adjustment: 'Корректировка',
    payout: 'Выплата',
  };
  const SAL_ACC_SIGN = {
    accrual: +1, bonus: +1, adjustment: +1, // adjustment может быть и -, см. amount sign
    penalty: -1, payout: -1,
  };
  // Накопления берём из кэша, который наполняется через API.
  function salLoadAccruals() {
    // backend хранит amount как signed (penalty/payout уже с минусом).
    // UI ожидает {type, amount: positive, signed (после применения SAL_ACC_SIGN)}.
    return cachedSalAccruals.map((a) => {
      const signedAmount = Number(a.amount) || 0;
      const isNeg = signedAmount < 0;
      const type = a.source_kind === 'bonus' ? 'bonus'
        : a.source_kind === 'penalty' ? 'penalty'
        : a.source_kind === 'manual' && a.source && /выплата/i.test(a.source) ? 'payout'
        : a.source_kind === 'manual' ? (isNeg ? 'payout' : 'bonus')
        : 'accrual';
      return {
        id: a.id,
        master_id: a.master_id,
        type,
        amount: Math.abs(signedAmount),
        period_from: a.period_from ? String(a.period_from).slice(0, 10) : null,
        period_to: a.period_to ? String(a.period_to).slice(0, 10) : null,
        created_at: a.created_at,
        source: a.source || '',
        reason: a.note || '',
      };
    });
  }
  function salSaveAccruals(_arr) { /* no-op: persist через API */ }

  async function salLoadAccrualsApi() {
    if (!store.access) { cachedSalAccruals = []; return; }
    const r = await salApi('GET', '/accruals');
    cachedSalAccruals = r.ok ? (r.data?.items || []) : [];
  }

  async function salLoadSettlements() {
    if (!store.access) { cachedSalSettlements = []; return; }
    const r = await salApi('GET', '/settlements');
    cachedSalSettlements = r.ok ? (r.data?.items || []) : [];
  }

  // ----- Tab 2: Settlements -----
  function renderSalarySettlements() {
    const list = document.getElementById('salSettleList');
    const summary = document.getElementById('salSettleSummary');
    if (!list) return;
    const filter = document.getElementById('salSettleMaster')?.value || '';
    const accruals = salLoadAccruals();
    let masters = cachedMasters.filter((m) => m.is_active);
    if (filter) masters = masters.filter((m) => m.id === filter);

    // агрегируем сальдо по мастеру
    const byMaster = new Map();
    masters.forEach((m) => byMaster.set(m.id, { master: m, balance: 0, ops: [] }));
    accruals.forEach((a) => {
      const slot = byMaster.get(a.master_id);
      if (!slot) return;
      const sign = (a.type === 'penalty' || a.type === 'payout') ? -1 : +1;
      const signed = Math.abs(Number(a.amount) || 0) * sign;
      slot.balance += signed;
      slot.ops.push({ ...a, signed });
    });

    const arr = Array.from(byMaster.values());
    arr.sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));

    let totalToPay = 0;
    arr.forEach((s) => { if (s.balance > 0) totalToPay += s.balance; });
    if (summary) summary.innerHTML = `Сальдо к выплате: <b>${totalToPay > 0 ? totalToPay.toLocaleString('ru-RU') + ' ₽' : '0 ₽'}</b>`;

    if (arr.length === 0) {
      list.innerHTML = '<div class="empty">Нет активных сотрудников.<div class="empty-hint">Добавьте сотрудников в разделе «Сотрудники».</div></div>';
      return;
    }

    list.innerHTML = arr.map((slot) => {
      const m = slot.master;
      const initials = (m.display_name || '?').split(' ').map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
      const balanceCls = slot.balance > 0 ? 'positive' : (slot.balance < 0 ? 'negative' : 'zero');
      const balanceStr = (slot.balance > 0 ? '+ ' : (slot.balance < 0 ? '− ' : '')) + Math.abs(slot.balance).toLocaleString('ru-RU') + ' ₽';

      const opsHtml = slot.ops.length === 0
        ? '<div class="sal-settle-empty">— нет операций —</div>'
        : slot.ops
            .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
            .slice(0, 8)
            .map((o) => {
              const date = (o.created_at || '').slice(0, 10);
              const cls = o.signed >= 0 ? 'positive' : 'negative';
              const amount = (o.signed >= 0 ? '+ ' : '− ') + Math.abs(o.signed).toLocaleString('ru-RU');
              return `
                <div class="sal-settle-row">
                  <div class="col-date">${escapeHtml(date)}</div>
                  <div class="col-doc">${escapeHtml(SAL_ACC_TYPE_LABELS[o.type] || o.type)}</div>
                  <div class="col-amount ${cls}">${amount}</div>
                  <div class="col-period">${escapeHtml(o.period_from && o.period_to ? `${o.period_from}…${o.period_to}` : '')}</div>
                  <div class="col-note">${escapeHtml(o.source || o.reason || '')}</div>
                </div>
              `;
            }).join('');

      return `
        <div class="sal-settle-card" data-master-id="${m.id}">
          <div class="sal-settle-head">
            <div class="user-avatar small" style="background:${stringToColor(m.id)}">${escapeHtml(initials || '?')}</div>
            <div class="sal-settle-head-info">
              <div class="sal-settle-name">${escapeHtml(m.display_name || '—')}</div>
              <div class="sal-settle-role">${escapeHtml(m.specialization || '')}</div>
            </div>
            <div class="sal-settle-balance ${balanceCls}">${balanceStr}</div>
            <button type="button" class="btn-success btn-sm sal-settle-payout" data-master-id="${m.id}" ${slot.balance <= 0 ? 'disabled title="Нет положительного сальдо"' : ''}>Выплата</button>
          </div>
          <div class="sal-settle-body">${opsHtml}</div>
          ${slot.ops.length > 0 ? `
            <div class="sal-settle-foot">
              <div class="sal-settle-foot-label">Операций: ${slot.ops.length}</div>
              <div class="sal-settle-foot-amount ${balanceCls}">Сальдо: ${balanceStr}</div>
            </div>` : ''}
        </div>
      `;
    }).join('');

    list.querySelectorAll('.sal-settle-payout').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        const id = btn.dataset.masterId;
        const slot = arr.find((s) => s.master.id === id);
        if (slot) salOpenPayoutModal(slot.master, slot.balance);
      });
    });
  }

  // ----- Tab 3: Accruals (журнал начислений) -----
  function renderSalaryAccruals() {
    const list = document.getElementById('salAccrualsList');
    if (!list) return;
    const filterMaster = document.getElementById('salAccrualsMaster')?.value || '';
    const filterType = document.getElementById('salAccrualsType')?.value || '';
    const accruals = salLoadAccruals();
    let items = accruals.slice();
    if (filterMaster) items = items.filter((a) => a.master_id === filterMaster);
    if (filterType) items = items.filter((a) => a.type === filterType);
    items.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

    if (items.length === 0) {
      list.innerHTML = '<div class="empty">За выбранный период начислений нет.<div class="empty-hint">Создайте первое из «Расчёт зарплаты» → «Начислить» или вручную «+ Премия / Штраф».</div></div>';
      return;
    }

    const masterMap = new Map(cachedMasters.map((m) => [m.id, m.display_name || '—']));
    list.innerHTML = items.map((a) => {
      const masterName = masterMap.get(a.master_id) || '—';
      const isNeg = a.type === 'penalty' || a.type === 'payout';
      const amount = (isNeg ? '− ' : '+ ') + Math.abs(Number(a.amount) || 0).toLocaleString('ru-RU') + ' ₽';
      const period = a.period_from && a.period_to
        ? `${a.period_from} — ${a.period_to}`
        : (a.period_from || '—');
      const date = (a.created_at || '').slice(0, 10);
      return `
        <div class="sal-row" data-acc-id="${a.id}">
          <div class="sg-col sg-col-master">${escapeHtml(masterName)}</div>
          <div class="sg-col"><span class="sal-acc-pill ${a.type}">${escapeHtml(SAL_ACC_TYPE_LABELS[a.type] || a.type)}</span></div>
          <div class="sg-col sg-col-num"><span class="sal-acc-amount ${isNeg ? 'negative' : 'positive'}">${amount}</span></div>
          <div class="sg-col sal-acc-period">${escapeHtml(period)}</div>
          <div class="sg-col sg-col-date sal-acc-date">${escapeHtml(date)}</div>
          <div class="sg-col sal-acc-source" title="${escapeHtml(a.source || a.reason || '')}">${escapeHtml(a.source || a.reason || '')}</div>
        </div>
      `;
    }).join('');
  }

  // ----- Modal: salary_payout -----
  function salOpenPayoutModal(master, suggestedAmount) {
    const today = todayLocalISO();
    document.getElementById('salPayoutMasterName').value = master.display_name || '—';
    document.getElementById('salPayoutMasterId').value = master.id;
    document.getElementById('salPayoutBalance').value = (suggestedAmount > 0 ? '+ ' : '') + (suggestedAmount || 0).toLocaleString('ru-RU') + ' ₽';
    document.getElementById('salPayoutAmount').value = Math.max(0, suggestedAmount || 0);
    document.getElementById('salPayoutAmount').setAttribute('max', String(Math.max(0, suggestedAmount || 0)));
    document.getElementById('salPayoutDate').value = today;
    document.getElementById('salPayoutNotes').value = '';
    // Populate account select from cached finance accounts (real UUIDs).
    const accSel = document.getElementById('salPayoutAccount');
    if (accSel) {
      accSel.innerHTML = cachedSalFinAccounts.length
        ? cachedSalFinAccounts.map((a) => `<option value="${a.id}">${escapeHtml(a.name)} · ${formatPrice(a.current_balance)}</option>`).join('')
        : '<option value="">— нет счетов —</option>';
    }
    const err = document.getElementById('salPayoutError'); if (err) err.hidden = true;
    document.getElementById('salPayoutModalBackdrop').hidden = false;
  }
  function salClosePayoutModal() {
    document.getElementById('salPayoutModalBackdrop').hidden = true;
    document.getElementById('salPayoutForm')?.reset();
  }
  async function salSubmitPayout(e) {
    e.preventDefault();
    const f = e.target;
    const fd = new FormData(f);
    const master_id = document.getElementById('salPayoutMasterId').value;
    const amount = Number(fd.get('amount')) || 0;
    const account_id = String(fd.get('account_id') || '');
    const date = String(fd.get('date') || todayLocalISO());
    const notes = String(fd.get('notes') || '');
    const err = document.getElementById('salPayoutError');
    if (!master_id || amount <= 0) {
      err.textContent = 'Сумма должна быть больше 0'; err.hidden = false; return;
    }
    if (!account_id) {
      err.textContent = 'Выберите счёт списания'; err.hidden = false; return;
    }
    // Saga в backend: создаст pending payout → POST /api/finance/operations/expense → posted.
    // На стороне finance.operations появится строка expense; settlements автоматически обновится.
    const r = await salApi('POST', '/payouts', {
      master_id, amount, account_id,
      paid_on: date,
      note: notes || undefined,
    });
    if (!r.ok) {
      err.textContent = 'Ошибка: ' + (r.data?.error || r.status);
      err.hidden = false;
      return;
    }
    salClosePayoutModal();
    await Promise.all([salLoadAccrualsApi(), salLoadSettlements()]);
    if (salActiveTab === 'settlements') renderSalarySettlements();
    if (salActiveTab === 'accruals') renderSalaryAccruals();
  }

  // ----- Modal: accrual_create -----
  function salOpenAccrualModal() {
    salPopulateMasterSelects(); // обновит и salAccrualMaster
    const sel = document.getElementById('salAccrualMaster');
    if (sel) {
      // у этого селекта свой плейсхолдер
      sel.innerHTML = '<option value="">— выберите —</option>' +
        cachedMasters.filter((m) => m.is_active).map((m) =>
          `<option value="${m.id}">${escapeHtml(m.display_name || '—')}</option>`).join('');
    }
    document.getElementById('salAccrualDate').value = todayLocalISO();
    document.getElementById('salAccrualAmount').value = '';
    document.getElementById('salAccrualReason').value = '';
    salUpdateAccrualSignHint();
    const err = document.getElementById('salAccrualError'); if (err) err.hidden = true;
    document.getElementById('salAccrualModalBackdrop').hidden = false;
  }
  function salCloseAccrualModal() {
    document.getElementById('salAccrualModalBackdrop').hidden = true;
    document.getElementById('salAccrualForm')?.reset();
  }
  function salUpdateAccrualSignHint() {
    const t = document.querySelector('input[name="acc_type"]:checked')?.value || 'bonus';
    const hint = document.getElementById('salAccrualSignHint');
    if (!hint) return;
    if (t === 'bonus') { hint.textContent = '+ к сальдо сотрудника (премия)'; hint.className = 'sal-acc-sign-hint positive'; }
    else if (t === 'penalty') { hint.textContent = '− из сальдо сотрудника (штраф)'; hint.className = 'sal-acc-sign-hint negative'; }
    else { hint.textContent = '± корректировка (введите положительное число)'; hint.className = 'sal-acc-sign-hint'; }
  }
  async function salSubmitAccrual(e) {
    e.preventDefault();
    const f = e.target;
    const fd = new FormData(f);
    const master_id = String(fd.get('master_id') || '');
    const type = String(fd.get('acc_type') || 'bonus');
    const amount = Number(fd.get('amount')) || 0;
    const reason = String(fd.get('reason') || '');
    const err = document.getElementById('salAccrualError');
    if (!master_id) { err.textContent = 'Выберите сотрудника'; err.hidden = false; return; }
    if (amount <= 0) { err.textContent = 'Сумма должна быть больше 0'; err.hidden = false; return; }
    if (!reason) { err.textContent = 'Укажите причину'; err.hidden = false; return; }
    // backend хранит signed amount: penalty → отрицательный
    const signedAmount = type === 'penalty' ? -amount : amount;
    const r = await salApi('POST', '/accruals', {
      master_id,
      amount: signedAmount,
      source_kind: type === 'penalty' ? 'penalty' : type === 'bonus' ? 'bonus' : 'manual',
      source: reason,
      note: reason,
    });
    if (!r.ok) {
      err.textContent = 'Ошибка: ' + (r.data?.error || r.status);
      err.hidden = false;
      return;
    }
    salCloseAccrualModal();
    await Promise.all([salLoadAccrualsApi(), salLoadSettlements()]);
    if (salActiveTab === 'accruals') renderSalaryAccruals();
    if (salActiveTab === 'settlements') renderSalarySettlements();
  }

  // Доработка switchTab — теперь рендерит и эти табы
  const _origSalSwitchTab = salSwitchTab;
  salSwitchTab = function(tab) {
    _origSalSwitchTab(tab);
    if (tab === 'settlements') renderSalarySettlements();
    if (tab === 'accruals') renderSalaryAccruals();
    if (tab === 'commissions') { renderSalaryCommissions(); renderStaffGroups(); }
  };
  // и activate тоже — обёртка дожидается загрузку данных и потом дорисовывает settlements/accruals
  const _origActivateSalary = activateSalaryView;
  activateSalaryView = async function() {
    await _origActivateSalary();
    if (salActiveTab === 'settlements') renderSalarySettlements();
    if (salActiveTab === 'accruals') renderSalaryAccruals();
  };

  // ----- Wiring -----
  document.querySelectorAll('#salarySubnav .subnav-item').forEach((b) => {
    b.addEventListener('click', () => salSwitchTab(b.dataset.salTab));
  });
  document.querySelectorAll('#salPayrollPeriod .period-pill').forEach((b) => {
    b.addEventListener('click', async () => {
      salPeriod = b.dataset.period;
      localStorage.setItem(SAL_LS_PERIOD, salPeriod);
      document.querySelectorAll('#salPayrollPeriod .period-pill').forEach((x) => {
        x.classList.toggle('active', x.dataset.period === salPeriod);
      });
      await salLoadCalc(salPeriodRange(salPeriod));
      renderSalaryPayroll();
    });
  });
  // правильно отметить сохранённый период при загрузке
  document.querySelectorAll('#salPayrollPeriod .period-pill').forEach((x) => {
    x.classList.toggle('active', x.dataset.period === salPeriod);
  });

  document.getElementById('salPayrollMaster')?.addEventListener('change', renderSalaryPayroll);
  document.getElementById('salSchemesMaster')?.addEventListener('change', renderSalarySchemes);

  document.getElementById('salPayrollRun')?.addEventListener('click', salOpenPayrollModal);
  document.getElementById('salPayrollRunSticky')?.addEventListener('click', salOpenPayrollModal);
  document.getElementById('salSchemesAdd')?.addEventListener('click', salOpenSchemeModal);

  // scheme modal
  document.getElementById('salSchemeModalClose')?.addEventListener('click', salCloseSchemeModal);
  document.getElementById('salSchemeCancel')?.addEventListener('click', salCloseSchemeModal);
  document.getElementById('salSchemeModalBackdrop')?.addEventListener('click', (e) => {
    if (e.target.id === 'salSchemeModalBackdrop') salCloseSchemeModal();
  });
  document.querySelectorAll('input[name="scheme_type"]').forEach((r) => {
    r.addEventListener('change', salUpdateSchemeFields);
  });
  document.getElementById('salSchemeForm')?.addEventListener('submit', salSubmitScheme);

  // payroll modal
  document.getElementById('salPayrollModalClose')?.addEventListener('click', salClosePayrollModal);
  document.getElementById('salPayrollCancel')?.addEventListener('click', salClosePayrollModal);
  document.getElementById('salPayrollModalBackdrop')?.addEventListener('click', (e) => {
    if (e.target.id === 'salPayrollModalBackdrop') salClosePayrollModal();
  });
  document.getElementById('salPayrollFrom')?.addEventListener('change', salRebuildPayrollPreview);
  document.getElementById('salPayrollTo')?.addEventListener('change', salRebuildPayrollPreview);
  document.getElementById('salPayrollForm')?.addEventListener('submit', salSubmitPayroll);

  // ----- Sprint 2 wiring -----
  document.getElementById('salSettleMaster')?.addEventListener('change', renderSalarySettlements);
  document.getElementById('salAccrualsMaster')?.addEventListener('change', renderSalaryAccruals);
  document.getElementById('salAccrualsType')?.addEventListener('change', renderSalaryAccruals);
  document.getElementById('salAccrualAdd')?.addEventListener('click', salOpenAccrualModal);

  // payout modal
  document.getElementById('salPayoutModalClose')?.addEventListener('click', salClosePayoutModal);
  document.getElementById('salPayoutCancel')?.addEventListener('click', salClosePayoutModal);
  document.getElementById('salPayoutModalBackdrop')?.addEventListener('click', (e) => {
    if (e.target.id === 'salPayoutModalBackdrop') salClosePayoutModal();
  });
  document.getElementById('salPayoutForm')?.addEventListener('submit', salSubmitPayout);

  // accrual modal
  document.getElementById('salAccrualModalClose')?.addEventListener('click', salCloseAccrualModal);
  document.getElementById('salAccrualCancel')?.addEventListener('click', salCloseAccrualModal);
  document.getElementById('salAccrualModalBackdrop')?.addEventListener('click', (e) => {
    if (e.target.id === 'salAccrualModalBackdrop') salCloseAccrualModal();
  });
  document.querySelectorAll('input[name="acc_type"]').forEach((r) => {
    r.addEventListener('change', salUpdateAccrualSignHint);
  });
  document.getElementById('salAccrualForm')?.addEventListener('submit', salSubmitAccrual);

  // Esc closes any salary modal
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!document.getElementById('salSchemeModalBackdrop')?.hidden) salCloseSchemeModal();
    if (!document.getElementById('salPayrollModalBackdrop')?.hidden) salClosePayrollModal();
    if (!document.getElementById('salPayoutModalBackdrop')?.hidden) salClosePayoutModal();
    if (!document.getElementById('salAccrualModalBackdrop')?.hidden) salCloseAccrualModal();
    if (!document.getElementById('salCommModalBackdrop')?.hidden) salCommCloseModal();
  });

  // ===== Commission rules (менеджерские комиссии по услугам) =====
  let cachedCommissions = [];

  async function salLoadCommissions() {
    const r = await salApi('GET', '/commissions');
    cachedCommissions = r.ok ? (r.data?.items || []) : [];
  }

  const COMM_TYPE_LABELS = {
    percent: '% всем менеджерам',
    fixed: 'Фикс. оформившему',
  };

  function renderSalaryCommissions() {
    // --- Секция: участники % пула ---
    const poolSection = document.getElementById('salCommPoolSection');
    if (poolSection) {
      const nonServiceStaff = cachedMasters.filter((m) => m.is_active && m.provides_services === false);
      if (nonServiceStaff.length === 0) {
        poolSection.innerHTML = '<div class="empty">Нет сотрудников с is_service=false.</div>';
      } else {
        poolSection.innerHTML = nonServiceStaff.map((m) => {
          const inPool = !!m.in_commission_pool;
          const pos = m.position || m.specialization || '—';
          return `
            <div class="sal-row" style="align-items:center;">
              <div class="sg-col sg-col-master">
                <div class="sal-master-cell">
                  <div class="user-avatar small" style="background:${stringToColor(m.id)}">${escapeHtml((m.display_name||'?').split(' ').map(p=>p[0]).filter(Boolean).slice(0,2).join('').toUpperCase())}</div>
                  <div class="sal-master-info">
                    <div class="sal-master-name">${escapeHtml(m.display_name)}</div>
                    <div class="sal-master-role">${escapeHtml(pos)}</div>
                  </div>
                </div>
              </div>
              <div class="sg-col">
                <label class="toggle-switch" title="${inPool ? 'Убрать из пула' : 'Добавить в пул'}">
                  <input type="checkbox" class="pool-toggle" data-master-id="${m.id}" ${inPool ? 'checked' : ''} />
                  <span class="toggle-track"></span>
                </label>
              </div>
              <div class="sg-col" style="color:var(--text-muted);font-size:12px;">
                ${inPool ? '<span class="badge badge-green">в пуле</span>' : '<span class="badge badge-gray">не в пуле</span>'}
              </div>
            </div>`;
        }).join('');
        poolSection.querySelectorAll('.pool-toggle').forEach((cb) => {
          cb.addEventListener('change', async () => {
            const masterId = cb.dataset.masterId;
            const r = await apiCall('PATCH', `/api/salons/masters/${masterId}`, { in_commission_pool: cb.checked });
            if (r.ok) {
              const m = cachedMasters.find((x) => x.id === masterId);
              if (m) m.in_commission_pool = cb.checked;
              renderSalaryCommissions();
            } else {
              cb.checked = !cb.checked;
              toast('Ошибка: ' + (r.data?.error || r.status));
            }
          });
        });
      }
    }

    // --- Секция: правила комиссий ---
    const list = document.getElementById('salCommList');
    if (!list) return;
    if (cachedCommissions.length === 0) {
      list.innerHTML = '<div class="empty">Правил комиссий пока нет. Кнопка «+ Добавить правило» — справа сверху.</div>';
      return;
    }
    list.innerHTML = cachedCommissions.map((c) => `
      <div class="sal-row" data-comm-id="${c.id}">
        <div class="sg-col sg-col-master">${escapeHtml(
          c.service_name || (c.category_name ? `Группа: ${c.category_name}` : '— все услуги —'),
        )}</div>
        <div class="sg-col">${escapeHtml(COMM_TYPE_LABELS[c.commission_type] || c.commission_type)}${
          c.staff_group_name ? ` → ${escapeHtml(c.staff_group_name)}` : ''
        }</div>
        <div class="sg-col sg-col-num">${c.commission_type === 'percent' ? c.amount + '%' : fmtMoney(c.amount) + ' ₽'}</div>
        <div class="sg-col sg-col-date">${escapeHtml((c.effective_from || '').slice(0, 10))}</div>
        <div class="sg-col sg-col-action">
          <button type="button" class="sal-row-action danger" data-comm-del="${c.id}" title="Удалить">×</button>
        </div>
      </div>
    `).join('');
    list.querySelectorAll('[data-comm-del]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Удалить правило комиссии?')) return;
        const r = await salApi('DELETE', `/commissions/${btn.dataset.commDel}`);
        if (r.ok) { await salLoadCommissions(); renderSalaryCommissions(); }
        else toast('Ошибка: ' + (r.data?.error || r.status));
      });
    });
  }

  // ===== Группы сотрудников (зарплата) =====
  let cachedStaffGroups = [];

  async function salLoadStaffGroups() {
    const r = await salApi('GET', '/staff-groups');
    cachedStaffGroups = r.ok ? (r.data?.items || []) : [];
  }

  function renderStaffGroups() {
    const host = document.getElementById('salGroupsList');
    if (!host) return;
    if (!cachedStaffGroups.length) {
      host.innerHTML = '<div class="empty">Групп пока нет. Кнопка «+ Создать группу» — справа сверху.</div>';
      return;
    }
    host.innerHTML = cachedStaffGroups.map((g) => {
      const names = (g.members || []).map((m) => m.display_name).filter(Boolean);
      return `
        <div class="sal-row" data-group-id="${g.id}">
          <div class="sg-col sg-col-master"><b>${escapeHtml(g.name)}</b></div>
          <div class="sg-col">${names.length ? escapeHtml(names.join(', ')) : '<span class="muted">нет участников</span>'}</div>
          <div class="sg-col sg-col-num">${names.length}</div>
          <div class="sg-col sg-col-action">
            <button type="button" class="sal-row-action" data-group-edit="${g.id}" title="Изменить">✎</button>
          </div>
        </div>`;
    }).join('');
    host.querySelectorAll('[data-group-edit]').forEach((btn) => {
      btn.addEventListener('click', () => salGroupOpenModal(btn.dataset.groupEdit));
    });
  }

  function salGroupOpenModal(groupId) {
    const back = document.getElementById('salGroupModalBackdrop');
    if (!back) return;
    const group = cachedStaffGroups.find((g) => g.id === groupId) || null;
    document.getElementById('salGroupForm')?.reset();
    document.getElementById('salGroupError').hidden = true;
    document.getElementById('salGroupId').value = group?.id || '';
    document.getElementById('salGroupName').value = group?.name || '';
    document.getElementById('salGroupModalTitle').textContent = group ? 'Изменить группу' : 'Новая группа';
    document.getElementById('salGroupDelete').hidden = !group;

    // Участники: активные сотрудники с галочками.
    const memberIds = new Set((group?.members || []).map((m) => m.master_id));
    const host = document.getElementById('salGroupMembers');
    if (host) {
      host.innerHTML = cachedMasters.filter((m) => m.is_active).map((m) => `
        <label class="service-pick">
          <input type="checkbox" value="${m.id}" ${memberIds.has(m.id) ? 'checked' : ''} />
          <span>${escapeHtml(m.display_name)}${m.position ? ' · ' + escapeHtml(m.position) : ''}</span>
        </label>
      `).join('');
    }
    back.hidden = false;
  }

  const salGroupCloseModal = () => {
    const back = document.getElementById('salGroupModalBackdrop');
    if (back) back.hidden = true;
  };

  document.getElementById('salGroupAddBtn')?.addEventListener('click', () => salGroupOpenModal(null));
  document.getElementById('salGroupModalClose')?.addEventListener('click', salGroupCloseModal);
  document.getElementById('salGroupModalCancel')?.addEventListener('click', salGroupCloseModal);

  document.getElementById('salGroupForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('salGroupError');
    errEl.hidden = true;
    const id = document.getElementById('salGroupId').value;
    const name = document.getElementById('salGroupName').value.trim();
    const member_ids = Array.from(
      document.querySelectorAll('#salGroupMembers input:checked'),
    ).map((cb) => cb.value);
    if (!name) { errEl.textContent = 'Укажите название'; errEl.hidden = false; return; }

    const r = id
      ? await salApi('PUT', `/staff-groups/${id}`, { name, member_ids })
      : await salApi('POST', '/staff-groups', { name, member_ids });
    if (!r.ok) {
      errEl.textContent = r.data?.error || 'Ошибка сохранения';
      errEl.hidden = false;
      return;
    }
    salGroupCloseModal();
    await salLoadStaffGroups();
    renderStaffGroups();
  });

  document.getElementById('salGroupDelete')?.addEventListener('click', async () => {
    const id = document.getElementById('salGroupId').value;
    if (!id) return;
    // Правила, начисляющие на эту группу, удалятся вместе с ней — предупреждаем.
    if (!confirm('Удалить группу? Правила начисления на неё тоже будут удалены.')) return;
    const r = await salApi('DELETE', `/staff-groups/${id}`);
    if (!r.ok) { toast('Ошибка: ' + (r.data?.error || r.status)); return; }
    salGroupCloseModal();
    await Promise.all([salLoadStaffGroups(), salLoadCommissions()]);
    renderStaffGroups();
    renderSalaryCommissions();
  });

  function salCommOpenModal() {
    const back = document.getElementById('salCommModalBackdrop');
    if (!back) return;
    document.getElementById('salCommForm')?.reset();
    document.getElementById('salCommError').hidden = true;
    // Заполняем услуги
    const sel = document.getElementById('salCommService');
    if (sel) {
      sel.innerHTML = '<option value="">— все услуги —</option>' +
        cachedServices.filter((s) => s.is_active).map((s) =>
          `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
    }
    // Группы услуг (категории) и группы сотрудников
    const catSel = document.getElementById('salCommCategory');
    if (catSel) {
      catSel.innerHTML = '<option value="">— не выбрана —</option>' +
        cachedServiceCategories.map((c) =>
          `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
    }
    const grpSel = document.getElementById('salCommGroup');
    if (grpSel) {
      grpSel.innerHTML = '<option value="">— всем в общем пуле —</option>' +
        cachedStaffGroups.map((g) =>
          `<option value="${g.id}">${escapeHtml(g.name)} (${(g.members || []).length})</option>`).join('');
    }
    // Дефолтная дата — сегодня
    const fromField = document.getElementById('salCommFrom');
    if (fromField && !fromField.value) fromField.value = todayLocalISO();
    // Обновляем label Amount при смене типа
    const typeEl = document.getElementById('salCommType');
    const amtLabel = document.getElementById('salCommAmountLabel');
    const updateLabel = () => {
      if (amtLabel) amtLabel.textContent = (typeEl?.value === 'percent') ? 'Размер (%)' : 'Сумма (₽)';
    };
    typeEl?.removeEventListener('change', updateLabel);
    typeEl?.addEventListener('change', updateLabel);
    updateLabel();
    back.hidden = false;
  }

  function salCommCloseModal() {
    const back = document.getElementById('salCommModalBackdrop');
    if (back) back.hidden = true;
  }

  document.getElementById('salCommAddBtn')?.addEventListener('click', salCommOpenModal);
  document.getElementById('salCommModalClose')?.addEventListener('click', salCommCloseModal);
  document.getElementById('salCommModalCancel')?.addEventListener('click', salCommCloseModal);
  document.getElementById('salCommModalBackdrop')?.addEventListener('click', (e) => {
    if (e.target.id === 'salCommModalBackdrop') salCommCloseModal();
  });
  document.getElementById('salCommForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('salCommError');
    errEl.hidden = true;
    const fd = new FormData(document.getElementById('salCommForm'));
    const payload = {
      service_id: fd.get('service_id') || null,
      category_id: fd.get('category_id') || null,
      staff_group_id: fd.get('staff_group_id') || null,
      commission_type: fd.get('commission_type'),
      amount: parseFloat(fd.get('amount')),
      effective_from: fd.get('effective_from') || undefined,
      notes: fd.get('notes') || null,
    };
    const r = await salApi('POST', '/commissions', payload);
    if (!r.ok) {
      errEl.textContent = r.data?.error || 'Ошибка сохранения';
      errEl.hidden = false;
      return;
    }
    salCommCloseModal();
    await salLoadCommissions();
    renderSalaryCommissions();
  });

  // ===== Settings (Sprint C — backed by salon-service /company + /schedule-templates) =====
  let settingsTab = 'company';
  let cachedCompanyProfile = null;
  let cachedScheduleTemplates = [];

  async function setApi(method, path, body) {
    return apiCall(method, '/api/salons' + path, body);
  }

  async function loadCompanyProfile() {
    const r = await setApi('GET', '/company');
    cachedCompanyProfile = r.ok ? r.data : null;
  }

  async function loadScheduleTemplates() {
    const r = await setApi('GET', '/schedule-templates');
    cachedScheduleTemplates = r.ok ? (r.data?.items || []) : [];
  }

  function setSwitchTab(tab) {
    settingsTab = tab;
    ['company', 'services', 'masters', 'templates', 'notifications', 'access'].forEach((t) => {
      const panel = document.getElementById('setTab' + t.charAt(0).toUpperCase() + t.slice(1));
      if (panel) panel.hidden = (t !== tab);
    });
    document.querySelectorAll('#settingsSubnav .subnav-item').forEach((b) => {
      b.classList.toggle('active', b.dataset.setTab === tab);
    });
    if (tab === 'company') renderCompanyForm();
    if (tab === 'templates') renderScheduleTemplates();
    if (tab === 'notifications') renderNotificationsForm();
    if (tab === 'access') void loadAccessUsers();
    if (tab === 'services') void loadSvcGroups();
  }

  // ===== Управление группами услуг (Настройки → Услуги) =====
  async function loadSvcGroups() {
    const listEl = document.getElementById('svcGroupsList');
    if (listEl) listEl.innerHTML = '<div class="empty">Загрузка…</div>';
    const r = await setApi('GET', '/categories');
    const groups = r.ok ? (r.data?.items || []) : [];
    cachedServiceCategories = groups; // синхронизируем кэш для модалки услуги
    const cnt = document.getElementById('svcGroupsCounter');
    if (cnt) cnt.textContent = String(groups.length);
    if (!listEl) return;
    if (!groups.length) { listEl.innerHTML = '<div class="empty">Групп пока нет. Добавьте первую выше.</div>'; return; }
    listEl.innerHTML = groups.map((g) => `
      <div class="row-item">
        <div class="row-main"><div class="row-name">${escapeHtml(g.name)}</div></div>
        <button type="button" class="btn-ghost btn-xs" data-grp-rename="${escapeHtml(g.id)}" data-grp-name="${escapeHtml(g.name)}">Переименовать</button>
        <button type="button" class="btn-ghost btn-xs" data-grp-del="${escapeHtml(g.id)}">Удалить</button>
      </div>`).join('');
    listEl.querySelectorAll('[data-grp-rename]').forEach((b) => {
      b.addEventListener('click', async () => {
        const name = prompt('Новое название группы:', b.dataset.grpName || '');
        if (name == null) return;
        const v = name.trim();
        if (!v) return;
        const r2 = await setApi('PATCH', `/categories/${b.dataset.grpRename}`, { name: v });
        if (!r2.ok) { toast(r2.status === 409 ? 'Группа с таким названием уже есть' : `Ошибка: ${r2.data?.error || r2.status}`); return; }
        cachedServiceCategories = [];
        toast('Группа переименована');
        await loadSvcGroups();
      });
    });
    listEl.querySelectorAll('[data-grp-del]').forEach((b) => {
      b.addEventListener('click', async () => {
        if (!confirm('Удалить группу? Услуги останутся, но без группы.')) return;
        const r2 = await setApi('DELETE', `/categories/${b.dataset.grpDel}`);
        if (!r2.ok) { toast(`Ошибка: ${r2.data?.error || r2.status}`); return; }
        cachedServiceCategories = [];
        toast('Группа удалена');
        await loadSvcGroups();
      });
    });
  }
  async function svcGroupAdd() {
    const inp = document.getElementById('svcGroupNewName');
    const name = (inp?.value || '').trim();
    if (!name) { toast('Введите название группы'); inp?.focus(); return; }
    const r = await setApi('POST', '/categories', { name });
    if (!r.ok) { toast(r.status === 409 ? 'Группа с таким названием уже есть' : `Ошибка: ${r.data?.error || r.status}`); return; }
    if (inp) inp.value = '';
    cachedServiceCategories = [];
    toast('Группа добавлена');
    await loadSvcGroups();
  }
  document.getElementById('svcGroupAddBtn')?.addEventListener('click', svcGroupAdd);
  document.getElementById('svcGroupNewName')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); svcGroupAdd(); }
  });

  // ===== RBAC: Доступ к проекту =====
  let accessCatalog = null;   // { modules, role_defaults }
  let accessUsers = [];
  const ROLE_LABELS = { owner: 'Владелец', admin: 'Администратор', master: 'Сотрудник', client: 'Клиент' };

  async function loadAccessUsers() {
    const listEl = document.getElementById('accessUsersList');
    if (listEl) listEl.innerHTML = '<div class="empty">Загрузка…</div>';
    if (!accessCatalog) {
      const c = await apiCall('GET', '/api/auth/permissions-catalog');
      accessCatalog = c.ok ? c.data : { modules: [], role_defaults: {} };
    }
    const r = await apiCall('GET', '/api/auth/users');
    if (!r.ok) {
      if (listEl) listEl.innerHTML = `<div class="empty">${r.status === 403 ? 'Недостаточно прав для управления доступом.' : 'Ошибка загрузки.'}</div>`;
      return;
    }
    accessUsers = r.data?.items || [];
    renderAccessUsers();
  }

  function permSummary(u) {
    const perms = u.permissions || {};
    const total = Object.keys(perms).length;
    const on = Object.values(perms).filter(Boolean).length;
    return `${on}/${total} прав`;
  }

  function renderAccessUsers() {
    const listEl = document.getElementById('accessUsersList');
    const cnt = document.getElementById('accessCounter');
    if (cnt) cnt.textContent = String(accessUsers.length);
    if (!listEl) return;
    if (!accessUsers.length) { listEl.innerHTML = '<div class="empty">Сотрудников нет.</div>'; return; }
    listEl.innerHTML = accessUsers.map((u) => `
      <div class="row-item ${u.is_active ? '' : 'inactive'}">
        <div class="row-main">
          <div class="row-name">${escapeHtml(u.full_name || u.email || u.phone || '—')}</div>
          <div class="row-meta">${escapeHtml(ROLE_LABELS[u.role] || u.role)} · ${escapeHtml(permSummary(u))}${u.is_active ? '' : ' · отключён'}</div>
        </div>
        <button type="button" class="btn-ghost btn-sm" data-access-edit="${escapeHtml(u.id)}">Настроить</button>
      </div>`).join('');
    listEl.querySelectorAll('[data-access-edit]').forEach((b) => {
      b.addEventListener('click', () => openAccessModal(b.dataset.accessEdit));
    });
  }

  function renderPermGroups(perms) {
    const wrap = document.getElementById('accessPermGroups');
    if (!wrap || !accessCatalog) return;
    wrap.innerHTML = (accessCatalog.modules || []).map((m) => `
      <div class="perm-group">
        <div class="perm-group-title">${escapeHtml(m.label)}</div>
        <div class="perm-actions">
          ${m.actions.map((a) => {
            const key = `${m.key}.${a.key}`;
            return `<label class="perm-item">
              <input type="checkbox" class="perm-check" data-key="${escapeHtml(key)}" ${perms[key] ? 'checked' : ''} />
              <span>${escapeHtml(a.label)}</span>
            </label>`;
          }).join('')}
        </div>
      </div>`).join('');
  }

  function openAccessModal(userId) {
    const u = accessUsers.find((x) => x.id === userId);
    if (!u) return;
    document.getElementById('accessUserId').value = u.id;
    document.getElementById('accessModalTitle').textContent = u.full_name || u.email || u.phone || 'Сотрудник';
    document.getElementById('accessRole').value = u.role;
    document.getElementById('accessModalError').hidden = true;
    // Поле пароля не переносим между сотрудниками — иначе легко задать пароль не тому.
    const pwdInput = document.getElementById('accessNewPassword');
    if (pwdInput) pwdInput.value = '';
    renderPermGroups(u.permissions || {});
    document.getElementById('accessModalBackdrop').hidden = false;
  }

  // Смена роли → подставить дефолтные права роли (с сервера)
  document.getElementById('accessRole')?.addEventListener('change', (e) => {
    const defaults = accessCatalog?.role_defaults?.[e.target.value];
    if (defaults) renderPermGroups(defaults);
  });

  document.getElementById('accessModalSave')?.addEventListener('click', async () => {
    const errEl = document.getElementById('accessModalError');
    errEl.hidden = true;
    const userId = document.getElementById('accessUserId').value;
    const role = document.getElementById('accessRole').value;
    const permissions = {};
    document.querySelectorAll('#accessPermGroups .perm-check').forEach((cb) => {
      permissions[cb.dataset.key] = cb.checked;
    });
    const r = await apiCall('PATCH', `/api/auth/users/${userId}`, { role, permissions });
    if (!r.ok) {
      errEl.textContent = r.data?.error || (r.status === 403 ? 'Недостаточно прав' : 'Ошибка сохранения');
      errEl.hidden = false;
      return;
    }
    document.getElementById('accessModalBackdrop').hidden = true;
    toast('Доступ обновлён');
    await loadAccessUsers();
  });
  // Задать пароль сотруднику — отдельной кнопкой, а не вместе с правами:
  // случайно сохранить непустое поле и разлогинить человека слишком легко.
  document.getElementById('accessPasswordSave')?.addEventListener('click', async () => {
    const errEl = document.getElementById('accessModalError');
    const input = document.getElementById('accessNewPassword');
    errEl.hidden = true;
    const userId = document.getElementById('accessUserId').value;
    const password = (input?.value || '').trim();
    if (password.length < 8) {
      errEl.textContent = 'Пароль — минимум 8 символов';
      errEl.hidden = false;
      return;
    }
    const r = await apiCall('PATCH', `/api/auth/users/${userId}/password`, { password });
    if (!r.ok) {
      errEl.textContent = r.data?.error || (r.status === 403 ? 'Недостаточно прав' : 'Ошибка смены пароля');
      errEl.hidden = false;
      return;
    }
    if (input) input.value = '';
    toast('Пароль изменён — сотрудник разлогинен на всех устройствах');
  });

  document.getElementById('accessModalClose')?.addEventListener('click', () => { document.getElementById('accessModalBackdrop').hidden = true; });
  document.getElementById('accessModalCancel')?.addEventListener('click', () => { document.getElementById('accessModalBackdrop').hidden = true; });
  document.getElementById('accessModalBackdrop')?.addEventListener('click', (e) => {
    if (e.target.id === 'accessModalBackdrop') document.getElementById('accessModalBackdrop').hidden = true;
  });

  async function activateSettingsView() {
    await Promise.all([loadCompanyProfile(), loadScheduleTemplates()]);
    setSwitchTab(settingsTab);
  }

  function renderCompanyForm() {
    if (!cachedCompanyProfile) return;
    const c = cachedCompanyProfile;
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v ?? ''; };
    set('setCompanyName', c.name);
    set('setCompanyPhone', c.phone);
    set('setCompanyEmail', c.email);
    set('setCompanyWebsite', c.website);
    set('setCompanyOpen', (c.default_open || '10:00:00').slice(0, 5));
    set('setCompanyClose', (c.default_close || '20:00:00').slice(0, 5));
    set('setCompanyTz', c.timezone);
    set('setCompanyLogo', c.logo_url);
    set('setCompanyAddress', c.address);
    set('setCompanyDescription', c.description);
  }

  function renderNotificationsForm() {
    const s = cachedCompanyProfile?.settings_jsonb || {};
    const n = s.notifications || {};
    const setChk = (id, k) => { const e = document.getElementById(id); if (e) e.checked = !!n[k]; };
    setChk('setNotifyWaReminder', 'wa_reminder');
    setChk('setNotifySmsConfirm', 'sms_confirm');
    setChk('setNotifyTgMaster', 'tg_master');
    setChk('setNotifyEmailOwner', 'email_owner');
    setChk('setNotifyEmailReminder', 'email_reminder');
    setChk('setNotifyMasterWa', 'notify_master_wa');
    setChk('setNotifyMasterEmail', 'notify_master_email');
    setChk('setNotifyBirthdayWa', 'birthday_wa');
    setChk('setNotifyBirthdayEmail', 'birthday_email');
    const bTplEl = document.getElementById('setNotifyBirthdayTpl');
    if (bTplEl) bTplEl.value = n.birthday_tpl || '';
    const tplBlock = document.getElementById('setReminderTplBlock');
    const cb = document.getElementById('setNotifyWaReminder');
    if (tplBlock && cb) {
      tplBlock.style.display = cb.checked ? 'flex' : 'none';
      cb.addEventListener('change', () => { tplBlock.style.display = cb.checked ? 'flex' : 'none'; });
    }
    const emailHint = document.getElementById('setEmailHint');
    const emailCb = document.getElementById('setNotifyEmailReminder');
    if (emailHint && emailCb) {
      emailHint.style.display = emailCb.checked ? 'flex' : 'none';
      emailCb.addEventListener('change', () => { emailHint.style.display = emailCb.checked ? 'flex' : 'none'; });
    }
    const t24 = document.getElementById('setReminderTpl24h');
    const t2h = document.getElementById('setReminderTpl2h');
    if (t24) t24.value = n.wa_reminder_tpl_24h || '';
    if (t2h) t2h.value = n.wa_reminder_tpl_2h || '';
  }

  const DOW_LABELS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  function dowMaskToString(mask) {
    const days = [];
    [1, 2, 4, 8, 16, 32, 64].forEach((bit, i) => { if (mask & bit) days.push(DOW_LABELS[i]); });
    if (days.length === 7) return 'каждый день';
    if (days.length === 5 && (mask & 31) === 31) return 'будни';
    if (days.length === 2 && (mask & 96) === 96) return 'выходные';
    return days.join(', ');
  }

  function renderScheduleTemplates() {
    const list = document.getElementById('setTemplatesList');
    const counter = document.getElementById('setTemplatesCounter');
    if (counter) counter.textContent = String(cachedScheduleTemplates.length);
    if (!list) return;
    if (!cachedScheduleTemplates.length) {
      list.innerHTML = '<div class="empty">Шаблонов пока нет. Нажмите «+ Шаблон».</div>';
      return;
    }
    list.innerHTML = cachedScheduleTemplates.map((t) => `
      <div class="row-item">
        <div class="row-main">
          <div class="row-name">${escapeHtml(t.name)}${t.is_default ? ' <span class="row-meta">(по умолчанию)</span>' : ''}</div>
          <div class="row-meta">${escapeHtml((t.start_time || '').slice(0, 5))}–${escapeHtml((t.end_time || '').slice(0, 5))} · ${escapeHtml(dowMaskToString(t.dow_mask))}</div>
        </div>
        <button type="button" class="btn-ghost btn-xs set-tmpl-edit" data-tmpl-id="${escapeHtml(t.id)}">Изм.</button>
        <button type="button" class="fin-del-btn set-tmpl-del" data-tmpl-id="${escapeHtml(t.id)}" aria-label="Удалить">×</button>
      </div>
    `).join('');
    list.querySelectorAll('.set-tmpl-edit').forEach((btn) => {
      btn.addEventListener('click', () => openTemplateModal(btn.dataset.tmplId));
    });
    list.querySelectorAll('.set-tmpl-del').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Удалить шаблон?')) return;
        const r = await setApi('DELETE', `/schedule-templates/${btn.dataset.tmplId}`);
        if (!r.ok) { toast('Ошибка: ' + (r.data?.error || r.status)); return; }
        await loadScheduleTemplates();
        renderScheduleTemplates();
      });
    });
  }

  function openTemplateModal(id) {
    const back = document.getElementById('setTemplateBackdrop');
    const modal = document.getElementById('setTemplateModal');
    const titleEl = document.getElementById('setTemplateModalTitle');
    const errEl = document.getElementById('setTemplateError');
    if (errEl) errEl.hidden = true;
    document.getElementById('setTemplateForm').reset();
    if (id) {
      const t = cachedScheduleTemplates.find((x) => x.id === id);
      if (!t) return;
      titleEl.textContent = 'Изменить шаблон';
      document.getElementById('setTemplateId').value = t.id;
      document.getElementById('setTemplateName').value = t.name;
      document.getElementById('setTemplateStart').value = (t.start_time || '').slice(0, 5);
      document.getElementById('setTemplateEnd').value = (t.end_time || '').slice(0, 5);
      document.getElementById('setTemplateDefault').checked = !!t.is_default;
      modal.querySelectorAll('[data-dow-bit]').forEach((cb) => {
        cb.checked = !!(t.dow_mask & Number(cb.dataset.dowBit));
      });
    } else {
      titleEl.textContent = 'Новый шаблон';
      document.getElementById('setTemplateId').value = '';
      document.getElementById('setTemplateStart').value = '10:00';
      document.getElementById('setTemplateEnd').value = '20:00';
      document.getElementById('setTemplateDefault').checked = false;
      modal.querySelectorAll('[data-dow-bit]').forEach((cb) => { cb.checked = true; });
    }
    back.hidden = false;
    modal.hidden = false;
  }

  function closeTemplateModal() {
    document.getElementById('setTemplateBackdrop').hidden = true;
    document.getElementById('setTemplateModal').hidden = true;
  }

  // Wiring (один раз на загрузке страницы)
  document.querySelectorAll('#settingsSubnav .subnav-item').forEach((b) => {
    b.addEventListener('click', () => setSwitchTab(b.dataset.setTab));
  });

  // Company form save
  document.getElementById('setCompanyForm')?.addEventListener('submit', (e) => e.preventDefault());
  document.getElementById('setCompanySave')?.addEventListener('click', async () => {
    const errEl = document.getElementById('setCompanyError');
    const okEl = document.getElementById('setCompanySaved');
    if (errEl) errEl.hidden = true;
    if (okEl) okEl.hidden = true;
    const get = (id) => document.getElementById(id)?.value?.trim() || null;
    const payload = {
      name: get('setCompanyName'),
      phone: get('setCompanyPhone'),
      email: get('setCompanyEmail'),
      website: get('setCompanyWebsite'),
      default_open: get('setCompanyOpen'),
      default_close: get('setCompanyClose'),
      timezone: get('setCompanyTz'),
      logo_url: get('setCompanyLogo'),
      address: get('setCompanyAddress'),
      description: get('setCompanyDescription'),
    };
    Object.keys(payload).forEach((k) => { if (payload[k] === null || payload[k] === '') payload[k] = null; });
    const r = await setApi('PUT', '/company', payload);
    if (!r.ok) {
      if (errEl) { errEl.hidden = false; errEl.textContent = 'Ошибка: ' + (r.data?.error || r.status); }
      return;
    }
    cachedCompanyProfile = r.data;
    if (okEl) { okEl.hidden = false; setTimeout(() => { okEl.hidden = true; }, 2000); }
  });

  // Notifications save (settings_jsonb.notifications)
  document.getElementById('setNotificationsSave')?.addEventListener('click', async () => {
    const okEl = document.getElementById('setNotificationsSaved');
    if (okEl) okEl.hidden = true;
    const settings = { ...(cachedCompanyProfile?.settings_jsonb || {}) };
    settings.notifications = {
      wa_reminder: document.getElementById('setNotifyWaReminder')?.checked || false,
      sms_confirm: document.getElementById('setNotifySmsConfirm')?.checked || false,
      tg_master: document.getElementById('setNotifyTgMaster')?.checked || false,
      email_owner: document.getElementById('setNotifyEmailOwner')?.checked || false,
      email_reminder: document.getElementById('setNotifyEmailReminder')?.checked || false,
      notify_master_wa: document.getElementById('setNotifyMasterWa')?.checked || false,
      notify_master_email: document.getElementById('setNotifyMasterEmail')?.checked || false,
      birthday_wa: document.getElementById('setNotifyBirthdayWa')?.checked || false,
      birthday_email: document.getElementById('setNotifyBirthdayEmail')?.checked || false,
      birthday_tpl: (document.getElementById('setNotifyBirthdayTpl')?.value || '').trim() || null,
      wa_reminder_tpl_24h: (document.getElementById('setReminderTpl24h')?.value || '').trim() || null,
      wa_reminder_tpl_2h: (document.getElementById('setReminderTpl2h')?.value || '').trim() || null,
    };
    const r = await setApi('PUT', '/company', { settings_jsonb: settings });
    if (!r.ok) { toast('Ошибка: ' + (r.data?.error || r.status)); return; }
    cachedCompanyProfile = r.data;
    if (okEl) { okEl.hidden = false; setTimeout(() => { okEl.hidden = true; }, 2000); }
  });

  // Templates: add / edit / delete
  document.getElementById('setTemplateAddBtn')?.addEventListener('click', () => openTemplateModal(null));
  document.getElementById('setTemplateClose')?.addEventListener('click', closeTemplateModal);
  document.getElementById('setTemplateCancel')?.addEventListener('click', closeTemplateModal);
  document.getElementById('setTemplateBackdrop')?.addEventListener('click', closeTemplateModal);
  document.getElementById('setTemplateForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('setTemplateError');
    if (errEl) errEl.hidden = true;
    const id = document.getElementById('setTemplateId').value;
    let dowMask = 0;
    document.getElementById('setTemplateModal').querySelectorAll('[data-dow-bit]').forEach((cb) => {
      if (cb.checked) dowMask |= Number(cb.dataset.dowBit);
    });
    if (dowMask === 0) { if (errEl) { errEl.hidden = false; errEl.textContent = 'Выберите хотя бы один день недели'; } return; }
    const payload = {
      name: document.getElementById('setTemplateName').value.trim(),
      start_time: document.getElementById('setTemplateStart').value,
      end_time: document.getElementById('setTemplateEnd').value,
      dow_mask: dowMask,
      is_default: document.getElementById('setTemplateDefault').checked,
    };
    const r = id
      ? await setApi('PATCH', `/schedule-templates/${id}`, payload)
      : await setApi('POST', '/schedule-templates', payload);
    if (!r.ok) {
      if (errEl) { errEl.hidden = false; errEl.textContent = 'Ошибка: ' + (r.data?.error || r.status); }
      return;
    }
    closeTemplateModal();
    await loadScheduleTemplates();
    renderScheduleTemplates();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const back = document.getElementById('setTemplateBackdrop');
      if (back && !back.hidden) closeTemplateModal();
    }
  });

  // ===== Master Card Modal (Sprint Step 3 — full employee card) =====
  // 4 active tabs (Профиль/График/Услуги/Схемы ЗП) + 4 stub tabs (Phase 2/3).
  let mcCurrentMaster = null;
  let mcCurrentTab = 'profile';

  async function openMasterCard(masterId) {
    const r = await apiCall('GET', `/api/salons/masters/${masterId}`);
    if (!r.ok) { toast('Не удалось загрузить сотрудника: ' + (r.data?.error || r.status)); return; }
    mcCurrentMaster = r.data;
    document.getElementById('mcBackdrop').hidden = false;
    document.getElementById('mcModal').hidden = false;
    // Защита от race-condition: первые 300мс игнорируем клик по backdrop
    // (исходный клик по строке мастера может всплыть до backdrop'а после async/await)
    const backdrop = document.getElementById('mcBackdrop');
    backdrop.dataset.justOpened = '1';
    setTimeout(() => { delete backdrop.dataset.justOpened; }, 300);
    mcCurrentTab = 'profile';
    mcSwitchTab('profile');
    mcRenderProfile();
    mcRenderHead();
  }

  function closeMasterCard() {
    document.getElementById('mcBackdrop').hidden = true;
    document.getElementById('mcModal').hidden = true;
    mcCurrentMaster = null;
    const errEl = document.getElementById('mcProfileError');
    if (errEl) errEl.hidden = true;
  }

  function mcRenderHead() {
    if (!mcCurrentMaster) return;
    const m = mcCurrentMaster;
    const name = m.display_name || `${m.last_name || ''} ${m.first_name || ''}`.trim() || '—';
    const initials = (name[0] || '?').toUpperCase();
    const headAv = document.getElementById('mcHeadAvatar');
    const largeAv = document.getElementById('mcAvatarLarge');
    applyAvatar(headAv, m, initials);
    applyAvatar(largeAv, m, initials);
    const delBtn = document.getElementById('mcAvatarDelBtn');
    if (delBtn) delBtn.hidden = !m.avatar_url;
    document.getElementById('mcTitle').textContent = name;
    document.getElementById('mcHeadSub').textContent = m.position || m.specialization || '';
  }

  // Показать аватар-картинку (если есть avatar_url) или инициалы на цветном фоне.
  function applyAvatar(el, m, initials) {
    if (!el) return;
    if (m.avatar_url) {
      el.textContent = '';
      el.style.backgroundImage = `url("${m.avatar_url}")`;
      el.style.backgroundSize = 'cover';
      el.style.backgroundPosition = 'center';
    } else {
      el.textContent = initials;
      el.style.backgroundImage = 'none';
      el.style.background = stringToColor(m.id);
    }
  }

  // Сжать выбранное изображение до max px по большей стороне → data-URL (jpeg).
  function resizeImageToDataURL(file, max) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onload = () => {
        const img = new Image();
        img.onerror = reject;
        img.onload = () => {
          let { width: w, height: h } = img;
          if (w > h && w > max) { h = Math.round(h * max / w); w = max; }
          else if (h > max) { w = Math.round(w * max / h); h = max; }
          const c = document.createElement('canvas');
          c.width = w; c.height = h;
          c.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(c.toDataURL('image/jpeg', 0.85));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  document.getElementById('mcAvatarUploadBtn')?.addEventListener('click', () => {
    document.getElementById('mcAvatarFile')?.click();
  });
  document.getElementById('mcAvatarFile')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !mcCurrentMaster) return;
    if (!file.type.startsWith('image/')) { toast('Выберите изображение'); return; }
    try {
      const dataUrl = await resizeImageToDataURL(file, 256);
      const r = await apiCall('PATCH', `/api/salons/masters/${mcCurrentMaster.id}`, { avatar_url: dataUrl });
      if (!r.ok) { toast('Ошибка загрузки фото: ' + (r.data?.error || r.status)); return; }
      mcCurrentMaster.avatar_url = dataUrl;
      mcRenderHead();
      toast('Фото обновлено');
      await loadMasters({ force: true });
    } catch { toast('Не удалось обработать изображение'); }
  });
  document.getElementById('mcAvatarDelBtn')?.addEventListener('click', async () => {
    if (!mcCurrentMaster) return;
    const r = await apiCall('PATCH', `/api/salons/masters/${mcCurrentMaster.id}`, { avatar_url: '' });
    if (!r.ok) { toast('Ошибка: ' + (r.data?.error || r.status)); return; }
    mcCurrentMaster.avatar_url = null;
    mcRenderHead();
    await loadMasters({ force: true });
  });

  function mcSwitchTab(tab) {
    mcCurrentTab = tab;
    document.querySelectorAll('#mcTabs .mc-tab').forEach((b) => {
      if (!b.classList.contains('disabled')) {
        b.classList.toggle('active', b.dataset.mcTab === tab);
      }
    });
    ['profile', 'schedule', 'services', 'schemes', 'access'].forEach((t) => {
      const panel = document.getElementById('mcPanel' + t.charAt(0).toUpperCase() + t.slice(1));
      if (panel) panel.hidden = (t !== tab);
    });
    if (tab === 'profile') mcRenderProfile();
    if (tab === 'schedule') void mcLoadSchedule();
    if (tab === 'services') void mcLoadServices();
    if (tab === 'schemes') void mcLoadSchemes();
    if (tab === 'access') void mcLoadAccess();
  }

  // ===== Карточка мастера: вкладка «Доступ» (роль + права связанного аккаунта) =====
  async function mcLoadAccess() {
    const el = document.getElementById('mcAccessContent');
    if (!el || !mcCurrentMaster) return;
    const userId = mcCurrentMaster.user_id;
    if (!userId) {
      el.innerHTML = `<div class="empty">У сотрудника нет учётной записи для входа.<br>
        Создайте её (логин/пароль) — тогда здесь появятся роль и права.</div>`;
      return;
    }
    el.innerHTML = '<div class="empty">Загрузка…</div>';
    if (!accessCatalog) {
      const c = await apiCall('GET', '/api/auth/permissions-catalog');
      accessCatalog = c.ok ? c.data : { modules: [], role_defaults: {} };
    }
    const r = await apiCall('GET', '/api/auth/users');
    if (!r.ok) {
      el.innerHTML = `<div class="empty">${r.status === 403 ? 'Недостаточно прав для управления доступом.' : 'Ошибка загрузки.'}</div>`;
      return;
    }
    const u = (r.data?.items || []).find((x) => x.id === userId);
    if (!u) { el.innerHTML = '<div class="empty">Учётная запись сотрудника не найдена.</div>'; return; }
    const perms = u.permissions || {};
    const groupsHtml = (accessCatalog.modules || []).map((m) => `
      <div class="perm-group">
        <div class="perm-group-title">${escapeHtml(m.label)}</div>
        <div class="perm-actions">
          ${m.actions.map((a) => {
            const key = `${m.key}.${a.key}`;
            return `<label class="perm-item"><input type="checkbox" class="mc-perm-check" data-key="${escapeHtml(key)}" ${perms[key] ? 'checked' : ''} /><span>${escapeHtml(a.label)}</span></label>`;
          }).join('')}
        </div>
      </div>`).join('');
    el.innerHTML = `
      <div style="margin-bottom:14px;max-width:320px;">
        <label for="mcAccessRole">Роль доступа</label>
        <select id="mcAccessRole">
          <option value="master">Сотрудник</option>
          <option value="admin">Администратор</option>
          <option value="owner">Владелец</option>
        </select>
      </div>
      <div id="mcAccessPermGroups">${groupsHtml}</div>
      <div class="error" id="mcAccessError" hidden></div>
      <div class="mc-actions"><button type="button" class="btn-primary" id="mcAccessSave">Сохранить доступ</button></div>`;
    document.getElementById('mcAccessRole').value = u.role;
    document.getElementById('mcAccessRole').addEventListener('change', (e) => {
      const defaults = accessCatalog?.role_defaults?.[e.target.value];
      if (!defaults) return;
      document.querySelectorAll('#mcAccessPermGroups .mc-perm-check').forEach((cb) => {
        cb.checked = !!defaults[cb.dataset.key];
      });
    });
    document.getElementById('mcAccessSave').addEventListener('click', async () => {
      const errEl = document.getElementById('mcAccessError');
      errEl.hidden = true;
      const role = document.getElementById('mcAccessRole').value;
      const permissions = {};
      document.querySelectorAll('#mcAccessPermGroups .mc-perm-check').forEach((cb) => {
        permissions[cb.dataset.key] = cb.checked;
      });
      const rr = await apiCall('PATCH', `/api/auth/users/${userId}`, { role, permissions });
      if (!rr.ok) {
        errEl.textContent = rr.data?.error || (rr.status === 403 ? 'Недостаточно прав' : 'Ошибка сохранения');
        errEl.hidden = false;
        return;
      }
      toast('Доступ обновлён');
    });
  }

  function mcRenderProfile() {
    if (!mcCurrentMaster) return;
    const m = mcCurrentMaster;
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v ?? ''; };
    set('mcFirstName', m.first_name);
    set('mcLastName', m.last_name);
    set('mcPosition', m.position || m.specialization);
    set('mcCategory', m.category);
    set('mcPhone', m.phone);
    set('mcEmail', m.email);
    set('mcNotes', m.notes);
    const cb = document.getElementById('mcProvidesServices');
    if (cb) cb.checked = !!m.provides_services;
    // Status toggle
    const isWorking = m.is_active && !m.dismissed_at;
    document.querySelectorAll('.mc-status-btn').forEach((b) => {
      const want = b.dataset.mcStatus === 'active';
      b.classList.toggle('active', want === isWorking);
    });
  }

  async function mcSaveProfile(e) {
    e.preventDefault();
    if (!mcCurrentMaster) return;
    const errEl = document.getElementById('mcProfileError');
    errEl.hidden = true;
    const get = (id) => document.getElementById(id)?.value?.trim() || '';
    const payload = {
      first_name: get('mcFirstName'),
      last_name: get('mcLastName') || null,
      position: get('mcPosition'),
      category: get('mcCategory'),
      phone: get('mcPhone') || null,
      email: get('mcEmail') || null,
      notes: get('mcNotes') || null,
      provides_services: document.getElementById('mcProvidesServices').checked,
    };
    if (!payload.first_name) {
      errEl.hidden = false; errEl.textContent = 'Имя обязательно'; return;
    }
    if (!payload.position) {
      errEl.hidden = false; errEl.textContent = 'Должность обязательна'; return;
    }
    if (!payload.category) {
      errEl.hidden = false; errEl.textContent = 'Выберите категорию'; return;
    }
    const r = await apiCall('PATCH', `/api/salons/masters/${mcCurrentMaster.id}`, payload);
    if (!r.ok) {
      errEl.hidden = false;
      errEl.textContent = 'Ошибка: ' + (r.data?.error || r.status);
      return;
    }
    mcCurrentMaster = r.data;
    mcRenderHead();
    await loadMasters();
    // Лёгкий toast
    errEl.style.color = '#16a34a'; errEl.style.background = '#f0fdf4'; errEl.style.borderColor = '#bbf7d0';
    errEl.textContent = 'Сохранено ✓'; errEl.hidden = false;
    setTimeout(() => {
      errEl.hidden = true;
      errEl.style.color = ''; errEl.style.background = ''; errEl.style.borderColor = '';
    }, 1800);
  }

  async function mcDeleteMaster() {
    if (!mcCurrentMaster) return;
    if (!confirm(`Удалить сотрудника «${mcCurrentMaster.display_name}»? Записи и история останутся.`)) return;
    const r = await apiCall('DELETE', `/api/salons/masters/${mcCurrentMaster.id}`);
    if (!r.ok) { toast('Ошибка: ' + (r.data?.error || r.status)); return; }
    closeMasterCard();
    await loadMasters();
  }

  async function mcSetStatus(active) {
    if (!mcCurrentMaster) return;
    const payload = active
      ? { is_active: true, dismissed_at: null }
      : { is_active: false, dismissed_at: new Date().toISOString() };
    const r = await apiCall('PATCH', `/api/salons/masters/${mcCurrentMaster.id}`, payload);
    if (!r.ok) { toast('Ошибка: ' + (r.data?.error || r.status)); return; }
    mcCurrentMaster = r.data;
    mcRenderProfile();
    await loadMasters();
  }

  // ----- Tab: График (preview расписания мастера) -----
  async function mcLoadSchedule() {
    if (!mcCurrentMaster) return;
    const content = document.getElementById('mcScheduleContent');
    const today = todayLocalISO();
    const monthStart = today.slice(0, 7) + '-01';
    const r = await apiCall('GET', `/api/salons/schedule/${mcCurrentMaster.id}?from=${monthStart}&to=${addDaysISO(monthStart, 30)}`);
    if (!r.ok) {
      content.innerHTML = '<div class="empty">Не удалось загрузить расписание.</div>';
      return;
    }
    const items = r.data?.items || [];
    if (!items.length) {
      content.innerHTML = `
        <div class="empty">Расписание на текущий месяц не задано.
          <div class="empty-hint">Откройте раздел «График работы» в левом меню чтобы заполнить.</div>
        </div>
        <div style="margin-top:16px;text-align:center;">
          <a href="#schedule" class="btn-primary btn-sm">Открыть График работы</a>
        </div>
      `;
      return;
    }
    // Сводка по дням недели за текущий месяц
    const byDow = [0, 0, 0, 0, 0, 0, 0]; // Mon..Sun count
    const hoursByDow = ['', '', '', '', '', '', ''];
    items.forEach((it) => {
      if (it.is_day_off) return;
      const [y, m, d] = it.work_date.split('-').map(Number);
      const dow = (new Date(y, m - 1, d).getDay() + 6) % 7; // Mon=0
      byDow[dow]++;
      if (!hoursByDow[dow] && it.start_time && it.end_time) {
        hoursByDow[dow] = `${it.start_time.slice(0, 5)}–${it.end_time.slice(0, 5)}`;
      }
    });
    const dowNames = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
    const summary = `
      <div class="mc-schedule-summary">
        ${dowNames.map((nm, i) => {
          const works = byDow[i] > 0;
          return `
            <div class="mc-sched-day ${works ? 'work' : 'off'}">
              <div class="mc-sched-day-label">${nm}</div>
              <div class="mc-sched-day-hours">${works ? escapeHtml(hoursByDow[i] || '—') : 'выходной'}</div>
              <div class="mc-sched-day-hours">${byDow[i]} дн.</div>
            </div>
          `;
        }).join('')}
      </div>
      <div class="empty-hint" style="margin-top: 12px;">Всего рабочих дней в этом месяце: ${items.filter((it) => !it.is_day_off).length} из ${items.length}.</div>
      <div style="margin-top:16px;text-align:center;">
        <a href="#schedule" class="btn-primary btn-sm">Изменить в разделе «График работы»</a>
      </div>
    `;
    content.innerHTML = summary;
  }

  // ----- Tab: Услуги (чекбоксы) -----
  async function mcLoadServices() {
    if (!mcCurrentMaster) return;
    const content = document.getElementById('mcServicesContent');
    if (!cachedServices.length) await loadServices();
    const masterServiceIds = new Set(mcCurrentMaster.service_ids || []);
    const items = cachedServices.filter((s) => s.is_active);
    if (!items.length) {
      content.innerHTML = '<div class="empty">У компании нет активных услуг.</div>';
      return;
    }
    const html = items.map((s) => {
      const checked = masterServiceIds.has(s.id);
      return `
        <label class="mc-service-row" data-service-id="${escapeHtml(s.id)}">
          <input type="checkbox" ${checked ? 'checked' : ''} />
          <span class="mc-service-name">${escapeHtml(s.name)}</span>
          <span class="mc-service-meta">${s.duration_minutes} мин · ${formatPrice(s.price)}</span>
        </label>
      `;
    }).join('');
    content.innerHTML = `
      <div class="mc-services-list">${html}</div>
      <div class="mc-actions" style="border-top: 1px solid var(--border); margin-top: 16px; padding-top: 16px;">
        <div class="empty-hint" id="mcServicesCount">Выбрано: ${masterServiceIds.size}</div>
        <button type="button" class="btn-primary" id="mcServicesSave">Сохранить услуги</button>
      </div>
    `;
    content.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      cb.addEventListener('change', () => {
        const sel = content.querySelectorAll('input[type="checkbox"]:checked').length;
        document.getElementById('mcServicesCount').textContent = `Выбрано: ${sel}`;
      });
    });
    document.getElementById('mcServicesSave').addEventListener('click', async () => {
      const ids = Array.from(content.querySelectorAll('.mc-service-row'))
        .filter((r) => r.querySelector('input').checked)
        .map((r) => r.dataset.serviceId);
      const r = await apiCall('PUT', `/api/salons/masters/${mcCurrentMaster.id}/services`, { service_ids: ids });
      if (!r.ok) { toast('Ошибка: ' + (r.data?.error || r.status)); return; }
      mcCurrentMaster.service_ids = ids;
      await loadMasters();
      toast(`Сохранено: ${ids.length} услуг`);
    });
  }

  // ----- Tab: Схемы ЗП -----
  async function mcLoadSchemes() {
    if (!mcCurrentMaster) return;
    const content = document.getElementById('mcSchemesContent');
    const r = await apiCall('GET', `/api/salary/schemes?master_id=${mcCurrentMaster.id}`);
    const schemes = r.ok ? (r.data?.items || []) : [];
    const TYPE_LABEL = {
      rate: 'Ставка',
      fixed: 'Ставка',
      rate_plus_percent: 'Ставка + %',
      fixed_plus_pct: 'Ставка + %',
      percent_only: '% с продаж',
      pct: '% с продаж',
    };
    if (!schemes.length) {
      content.innerHTML = `
        <div class="empty">У сотрудника пока нет схем расчёта зарплаты.
          <div class="empty-hint">Откройте раздел «Зарплата → Схемы расчёта» чтобы создать.</div>
        </div>
        <div style="margin-top:16px;text-align:center;">
          <a href="#salary" class="btn-primary btn-sm">Перейти в Зарплату</a>
        </div>
      `;
      return;
    }
    content.innerHTML = `
      <div class="mc-schemes-list">
        ${schemes.map((s) => `
          <div class="mc-scheme-row">
            <div class="mc-scheme-type">${escapeHtml(TYPE_LABEL[s.scheme_type] || s.scheme_type)}</div>
            <div class="mc-scheme-period">с ${escapeHtml(String(s.effective_from || '').slice(0, 10))}${s.effective_to ? ' по ' + String(s.effective_to).slice(0, 10) : ' (актуальная)'}</div>
            <div class="mc-scheme-period">${s.rate_amount > 0 ? formatPrice(s.rate_amount) + '/' + (s.rate_period === 'day' ? 'день' : s.rate_period === 'week' ? 'нед' : 'мес') : ''}${s.percent_services > 0 ? ' · ' + s.percent_services + '%' : ''}</div>
          </div>
        `).join('')}
      </div>
      <div style="margin-top:16px;text-align:center;">
        <a href="#salary" class="btn-primary btn-sm">Управлять в разделе «Зарплата»</a>
      </div>
    `;
  }

  // ----- Wiring -----
  document.querySelectorAll('#mcTabs .mc-tab[data-mc-tab]').forEach((b) => {
    b.addEventListener('click', () => {
      if (!b.classList.contains('disabled')) mcSwitchTab(b.dataset.mcTab);
    });
  });
  document.getElementById('mcClose')?.addEventListener('click', closeMasterCard);
  document.getElementById('mcBackdrop')?.addEventListener('click', (e) => {
    const backdrop = e.currentTarget;
    if (backdrop.dataset.justOpened) return; // игнорим случайный bubble в первые 300мс
    if (e.target === backdrop) closeMasterCard(); // только по самому backdrop, не bubble
  });
  document.getElementById('mcProfileForm')?.addEventListener('submit', mcSaveProfile);
  document.getElementById('mcDelete')?.addEventListener('click', mcDeleteMaster);
  document.querySelectorAll('.mc-status-btn').forEach((b) => {
    b.addEventListener('click', () => mcSetStatus(b.dataset.mcStatus === 'active'));
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const mod = document.getElementById('mcModal');
      if (mod && !mod.hidden) closeMasterCard();
    }
  });

  // ===== Inventory: Сменное списание + Инвентаризация =====
  function invShiftRowHtml(idx) {
    const productOpts = '<option value="">— выберите —</option>'
      + cachedProducts.filter((p) => p.is_active && p.tracking_mode !== 'expense_only')
        .map((p) => `<option value="${p.id}" data-unit="${escapeHtml(p.unit)}">${escapeHtml(p.name)} (есть ${Number(p.stock_qty || 0)} ${escapeHtml(p.unit)})</option>`).join('');
    return `
      <div class="receipt-item" data-shift-idx="${idx}">
        <select class="shift-product" name="product_id"><div>${productOpts}</div></select>
        <input type="number" class="shift-qty" name="qty" min="0" step="any" placeholder="0" />
        <input type="text" class="shift-note" name="note" placeholder="Заметка (опц.)" style="flex:2"/>
        <button type="button" class="btn-ghost btn-xs shift-remove" aria-label="Убрать">×</button>
      </div>
    `;
  }

  function invShiftAddRow() {
    const list = document.getElementById('invShiftItems');
    if (!list) return;
    const idx = list.children.length;
    list.insertAdjacentHTML('beforeend', invShiftRowHtml(idx));
    // Восстановить опции у нового select (раз innerHTML с <div>опций даёт битый разметку — переделаем)
    const newRow = list.lastElementChild;
    const sel = newRow.querySelector('.shift-product');
    sel.innerHTML = '<option value="">— выберите —</option>'
      + cachedProducts.filter((p) => p.is_active && p.tracking_mode !== 'expense_only')
        .map((p) => `<option value="${p.id}" data-unit="${escapeHtml(p.unit)}">${escapeHtml(p.name)} (есть ${Number(p.stock_qty || 0)} ${escapeHtml(p.unit)})</option>`).join('');
    newRow.querySelector('.shift-remove').addEventListener('click', () => newRow.remove());
  }

  async function openInvShiftModal() {
    if (!cachedProducts.length) await loadProducts();
    if (!cachedMasters.length) await loadMasters();
    document.getElementById('invShiftBackdrop').hidden = false;
    document.getElementById('invShiftModal').hidden = false;
    document.getElementById('invShiftDate').value = todayLocalISO();
    document.getElementById('invShiftNote').value = '';
    document.getElementById('invShiftItems').innerHTML = '';
    invShiftAddRow();
    // Master select
    const ms = document.getElementById('invShiftMaster');
    ms.innerHTML = '<option value="">— общая смена —</option>'
      + cachedMasters.filter((m) => m.is_active).map((m) =>
        `<option value="${m.id}">${escapeHtml(m.display_name || '—')}</option>`).join('');
    document.getElementById('invShiftError').hidden = true;
  }

  function closeInvShiftModal() {
    document.getElementById('invShiftBackdrop').hidden = true;
    document.getElementById('invShiftModal').hidden = true;
  }

  async function submitInvShift(e) {
    e.preventDefault();
    const errEl = document.getElementById('invShiftError');
    errEl.hidden = true;
    const items = [];
    document.querySelectorAll('#invShiftItems .receipt-item').forEach((row) => {
      const productId = row.querySelector('.shift-product').value;
      const qty = parseFloat(row.querySelector('.shift-qty').value);
      const note = row.querySelector('.shift-note').value.trim();
      if (productId && qty > 0) items.push({ product_id: productId, qty, note: note || undefined });
    });
    if (!items.length) {
      errEl.hidden = false; errEl.textContent = 'Добавьте хотя бы одну позицию с количеством > 0';
      return;
    }
    const masterId = document.getElementById('invShiftMaster').value || null;
    const r = await apiCall('POST', '/api/inventory/stock/consumption', {
      items,
      master_id: masterId || undefined,
      consumed_at: document.getElementById('invShiftDate').value || undefined,
      shift_note: document.getElementById('invShiftNote').value.trim() || undefined,
    });
    if (!r.ok) {
      errEl.hidden = false; errEl.textContent = 'Ошибка: ' + (r.data?.error || r.status);
      return;
    }
    closeInvShiftModal();
    await loadProducts();
    toast(`Списано ${items.length} позиций. Стоимость: ${formatPrice(r.data.total_cost || 0)}`);
  }

  async function openInvCheckModal() {
    if (!cachedProducts.length) await loadProducts();
    document.getElementById('invCheckBackdrop').hidden = false;
    document.getElementById('invCheckModal').hidden = false;
    document.getElementById('invCheckDate').value = todayLocalISO();
    document.getElementById('invCheckNote').value = '';
    document.getElementById('invCheckError').hidden = true;
    // Render rows: только активные товары на складе
    const tbody = document.getElementById('invCheckRows');
    const products = cachedProducts.filter((p) => p.is_active && p.tracking_mode !== 'expense_only');
    if (!products.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="empty">Нет товаров для инвентаризации.</td></tr>';
      return;
    }
    tbody.innerHTML = products.map((p) => `
      <tr data-product-id="${p.id}" data-stock="${Number(p.stock_qty || 0)}">
        <td>${escapeHtml(p.name)} <span class="row-meta">${escapeHtml(p.unit)}</span></td>
        <td class="row-meta">${Number(p.stock_qty || 0)}</td>
        <td><input type="number" class="check-actual" min="0" step="any" placeholder="${Number(p.stock_qty || 0)}" /></td>
        <td class="check-variance">—</td>
      </tr>
    `).join('');
    // Live variance calc
    tbody.querySelectorAll('.check-actual').forEach((inp) => {
      inp.addEventListener('input', () => {
        const tr = inp.closest('tr');
        const stock = Number(tr.dataset.stock);
        const actual = parseFloat(inp.value);
        const cell = tr.querySelector('.check-variance');
        if (isNaN(actual)) { cell.textContent = '—'; cell.className = 'check-variance variance-zero'; return; }
        const v = actual - stock;
        cell.textContent = (v > 0 ? '+' : '') + v.toFixed(2);
        cell.className = 'check-variance ' + (Math.abs(v) < 0.001 ? 'variance-zero' : v > 0 ? 'variance-positive' : 'variance-negative');
      });
    });
  }

  function closeInvCheckModal() {
    document.getElementById('invCheckBackdrop').hidden = true;
    document.getElementById('invCheckModal').hidden = true;
  }

  async function submitInvCheck(e) {
    e.preventDefault();
    const errEl = document.getElementById('invCheckError');
    errEl.hidden = true;
    const items = [];
    document.querySelectorAll('#invCheckRows tr[data-product-id]').forEach((tr) => {
      const inp = tr.querySelector('.check-actual');
      const v = parseFloat(inp.value);
      if (!isNaN(v) && v >= 0) items.push({ product_id: tr.dataset.productId, actual_qty: v });
    });
    if (!items.length) {
      errEl.hidden = false; errEl.textContent = 'Введите факт хотя бы для одной позиции';
      return;
    }
    if (!confirm(`Применить инвентаризацию: ${items.length} позиций? Расхождения будут списаны/добавлены.`)) return;
    const r = await apiCall('POST', '/api/inventory/stock/inventory-check', {
      items,
      checked_at: document.getElementById('invCheckDate').value || undefined,
      note: document.getElementById('invCheckNote').value.trim() || undefined,
    });
    if (!r.ok) {
      errEl.hidden = false; errEl.textContent = 'Ошибка: ' + (r.data?.error || r.status);
      return;
    }
    closeInvCheckModal();
    await loadProducts();
    toast(`Инвентаризация применена. Изменено позиций: ${r.data.total_changes || 0}`);
  }

  // Wiring
  document.getElementById('invShiftWriteoffBtn')?.addEventListener('click', () => void openInvShiftModal());
  document.getElementById('invInventoryCheckBtn')?.addEventListener('click', () => void openInvCheckModal());
  document.getElementById('invShiftClose')?.addEventListener('click', closeInvShiftModal);
  document.getElementById('invShiftCancel')?.addEventListener('click', closeInvShiftModal);
  document.getElementById('invShiftBackdrop')?.addEventListener('click', closeInvShiftModal);
  document.getElementById('invShiftAddItem')?.addEventListener('click', invShiftAddRow);
  document.getElementById('invShiftForm')?.addEventListener('submit', submitInvShift);
  document.getElementById('invCheckClose')?.addEventListener('click', closeInvCheckModal);
  document.getElementById('invCheckCancel')?.addEventListener('click', closeInvCheckModal);
  document.getElementById('invCheckBackdrop')?.addEventListener('click', closeInvCheckModal);
  document.getElementById('invCheckForm')?.addEventListener('submit', submitInvCheck);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const sm = document.getElementById('invShiftModal'); if (sm && !sm.hidden) closeInvShiftModal();
    const cm = document.getElementById('invCheckModal'); if (cm && !cm.hidden) closeInvCheckModal();
  });

  // ===== ANALYTICS =====

  let analyticsPeriod = 'month';

  function getAnalyticsRange(period) {
    const today = todayLocalISO();
    if (period === 'today')  return { from: today, to: today };
    if (period === 'yesterday') {
      const d = new Date(today + 'T00:00:00'); d.setDate(d.getDate() - 1);
      const y = d.toISOString().slice(0, 10);
      return { from: y, to: y };
    }
    if (period === 'week')  {
      const d = new Date(today + 'T00:00:00'); d.setDate(d.getDate() - 6);
      return { from: d.toISOString().slice(0, 10), to: today };
    }
    if (period === 'month') {
      const d = new Date(today + 'T00:00:00');
      return { from: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`, to: today };
    }
    if (period === 'year') {
      return { from: `${new Date(today + 'T00:00:00').getFullYear()}-01-01`, to: today };
    }
    return { from: today, to: today };
  }

  // ===== Today Dashboard =====
  let todayClockTimer = null;

  function startTodayClock() {
    const el = document.getElementById('todayClock');
    if (!el) return;
    const tick = () => {
      const now = new Date();
      el.textContent = now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    };
    tick();
    if (todayClockTimer) clearInterval(todayClockTimer);
    todayClockTimer = setInterval(tick, 1000);
  }

  async function loadTodayDashboard() {
    const today = todayLocalISO();

    // header
    const dayEl = document.getElementById('todayDayLabel');
    const dateEl = document.getElementById('todayDateFull');
    if (dayEl) dayEl.textContent = 'Сегодня';
    if (dateEl) {
      dateEl.textContent = new Date(today + 'T12:00:00').toLocaleDateString('ru-RU', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      });
    }
    startTodayClock();

    // fetch bookings for today
    let bookings = [];
    try {
      const r = await apiFetch(`/api/bookings?from=${today}&to=${today}&limit=200`);
      bookings = r.items || [];
    } catch { /* show empty state */ }

    // KPIs
    const total = bookings.length;
    const completed = bookings.filter((b) => b.status === 'completed').length;
    const active = bookings.filter((b) => b.status === 'pending' || b.status === 'confirmed').length;
    const canceled = bookings.filter((b) => b.status === 'canceled' || b.status === 'no_show').length;
    const revenue = bookings
      .filter((b) => b.status === 'completed')
      .reduce((s, b) => s + (b.total_price || 0), 0);

    const set = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
    set('tdTotal', total);
    set('tdCompleted', completed);
    set('tdActive', active);
    set('tdCanceled', canceled);
    set('tdRevenue', formatPrice(revenue));

    // Timeline
    const tlEl = document.getElementById('todayTimeline');
    if (tlEl) {
      if (!bookings.length) {
        tlEl.innerHTML = '<div class="today-empty">Записей на сегодня нет</div>';
      } else {
        const STATUS_RU = { pending: 'Ожидает', confirmed: 'Подтверждена', completed: 'Выполнена', canceled: 'Отменена', no_show: 'Не пришёл' };
        const nowMs = Date.now();
        tlEl.innerHTML = bookings.map((b) => {
          const start = new Date(b.starts_at);
          const end = new Date(b.ends_at);
          const isActive = nowMs >= start.getTime() && nowMs < end.getTime() && b.status !== 'canceled' && b.status !== 'completed';
          const svcNames = (b.services || []).map((s) => s.service_name).join(', ');
          const masterName = b.master_name || '';
          return `<div class="today-bk status-${b.status}${isActive ? ' status-active' : ''}">
            <div class="today-bk-time">
              ${start.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
              <small>${end.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</small>
            </div>
            <div class="today-bk-info">
              <div class="today-bk-client">${escapeHtml(b.client_name || b.client_phone)}</div>
              ${masterName ? `<div class="today-bk-master">${escapeHtml(masterName)}</div>` : ''}
              <div class="today-bk-services">${escapeHtml(svcNames)}</div>
            </div>
            <div style="text-align:right">
              <div class="today-bk-price">${formatPrice(b.total_price)}</div>
              <div class="today-bk-status">${STATUS_RU[b.status] || b.status}</div>
            </div>
          </div>`;
        }).join('');
      }
    }

    // Masters load
    const mastersEl = document.getElementById('todayMasters');
    if (mastersEl) {
      const byMaster = {};
      for (const b of bookings) {
        if (b.status === 'canceled' || b.status === 'no_show') continue;
        const key = b.master_id || 'unknown';
        const name = b.master_name || b.master_id || 'Не назначен';
        if (!byMaster[key]) byMaster[key] = { name, count: 0 };
        byMaster[key].count++;
      }
      const entries = Object.values(byMaster).sort((a, b) => b.count - a.count);
      const maxCount = entries[0]?.count || 1;
      if (!entries.length) {
        mastersEl.innerHTML = '<div class="today-empty">Нет активных мастеров</div>';
      } else {
        mastersEl.innerHTML = entries.map((m) => {
          const pct = Math.round((m.count / maxCount) * 100);
          return `<div class="today-master-row">
            <div class="today-master-name">${escapeHtml(m.name)}</div>
            <div class="today-master-count">${m.count} зап.</div>
            <div class="today-master-bar-wrap"><div class="today-master-bar" style="width:${pct}%"></div></div>
          </div>`;
        }).join('');
      }
    }

    // Refresh button
    document.getElementById('todayRefreshBtn')?.addEventListener('click', () => loadTodayDashboard(), { once: true });
  }

  async function activateAnalyticsView() {
    await loadAnalytics();
  }

  let analyticsTab = 'overview';

  async function loadAnalytics() {
    const { from, to } = getAnalyticsRange(analyticsPeriod);
    if (analyticsTab === 'overview') {
      const [main, retention, reviews] = await Promise.all([
        apiCall('GET', `/api/bookings/analytics?from=${from}&to=${to}`),
        apiCall('GET', '/api/bookings/retention'),
        apiCall('GET', '/api/bookings/reviews'),
      ]);
      if (main.ok) {
        renderAnalyticsKpi(main.data.kpi);
        renderAnalyticsByDay(main.data.by_day);
        renderAnalyticsTopServices(main.data.top_services);
        renderAnalyticsByMaster(main.data.by_master);
      }
      if (retention.ok) renderRetention(retention.data);
      if (reviews.ok) renderReviews(reviews.data);
    } else if (analyticsTab === 'services') {
      const res = await apiCall('GET', `/api/bookings/analytics/services?from=${from}&to=${to}`);
      if (res.ok) renderAnServices(res.data.services);
    } else if (analyticsTab === 'retention') {
      const groupBy = document.getElementById('retGroupBy')?.value || 'category';
      const churn = document.getElementById('retChurnDays')?.value || '180';
      // Период не передаём: возвращаемость считается по всей истории, иначе
      // «вернулся» будет означать «вернулся в пределах выбранного месяца».
      const res = await apiCall(
        'GET',
        `/api/bookings/analytics/retention-by-service?group_by=${groupBy}&churn_days=${churn}`,
      );
      if (res.ok) renderAnRetention(res.data.items);
    } else if (analyticsTab === 'products') {
      const res = await apiCall('GET', `/api/inventory/stock/consumption-report?from=${from}&to=${to}`);
      if (res.ok) renderAnProducts(res.data.items);
    } else if (analyticsTab === 'topups') {
      const res = await apiCall('GET', `/api/clients/balance/topups-report?from=${from}&to=${to}`);
      if (res.ok) renderAnTopups(res.data);
    } else {
      const res = await apiCall('GET', `/api/bookings/analytics/masters?from=${from}&to=${to}`);
      if (res.ok) renderMastersReport(res.data.masters);
    }
  }

  function renderAnRetention(items) {
    const tbody = document.querySelector('#anRetentionTable tbody');
    if (!tbody) return;
    if (!items || !items.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="table-empty">Нет завершённых записей — статистика появится после первых оформленных продаж</td></tr>';
      return;
    }
    // Цветовая шкала: возвращаемость ниже 30% — повод разобраться.
    const rateClass = (r) => (r >= 60 ? 'ret-good' : r >= 30 ? 'ret-mid' : 'ret-low');
    tbody.innerHTML = items.map((x) => `
      <tr>
        <td>${escapeHtml(x.group_name || '—')}</td>
        <td style="text-align:right;">${x.clients}</td>
        <td style="text-align:right;">${x.returned_clients}</td>
        <td style="text-align:right;"><span class="ret-badge ${rateClass(x.return_rate || 0)}">${(x.return_rate ?? 0).toFixed(1)}%</span></td>
        <td style="text-align:right;">${(x.avg_visits ?? 0).toFixed(1)}</td>
        <td style="text-align:right;">${x.avg_days_between != null ? Math.round(x.avg_days_between) : '—'}</td>
        <td style="text-align:right;">${x.churned_clients}</td>
        <td style="text-align:right;font-weight:600;">${formatPrice(x.revenue)}</td>
      </tr>`).join('');
  }

  document.getElementById('retGroupBy')?.addEventListener('change', () => void loadAnalytics());
  document.getElementById('retChurnDays')?.addEventListener('change', () => void loadAnalytics());

  function renderAnServices(services) {
    const tbody = document.querySelector('#anServicesTable tbody');
    if (!tbody) return;
    if (!services || !services.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="table-empty">Нет данных за период</td></tr>';
      return;
    }
    const totalRev = services.reduce((s, x) => s + (x.revenue || 0), 0);
    const totalCnt = services.reduce((s, x) => s + (x.count || 0), 0);
    tbody.innerHTML = services.map((s) => `
      <tr>
        <td>${escapeHtml(s.service_name || '—')}</td>
        <td style="text-align:right;">${s.count}</td>
        <td style="text-align:right;">${formatPrice(s.avg_price)}</td>
        <td style="text-align:right;font-weight:600;">${formatPrice(s.revenue)}</td>
      </tr>`).join('')
      + `<tr style="border-top:2px solid var(--border);font-weight:700;">
           <td>Итого</td><td style="text-align:right;">${totalCnt}</td><td></td>
           <td style="text-align:right;">${formatPrice(totalRev)}</td>
         </tr>`;
  }

  function renderAnProducts(items) {
    const tbody = document.querySelector('#anProductsTable tbody');
    if (!tbody) return;
    if (!items || !items.length) {
      tbody.innerHTML = '<tr><td colspan="3" class="table-empty">Расхода за период нет</td></tr>';
      return;
    }
    const totalCost = items.reduce((s, x) => s + (x.cost || 0), 0);
    tbody.innerHTML = items.map((p) => `
      <tr>
        <td>${escapeHtml(p.product_name || '—')}</td>
        <td style="text-align:right;">${(Number(p.qty) || 0).toLocaleString('ru-RU')} ${escapeHtml(p.unit || '')}</td>
        <td style="text-align:right;font-weight:600;">${formatPrice(p.cost)}</td>
      </tr>`).join('')
      + `<tr style="border-top:2px solid var(--border);font-weight:700;">
           <td>Итого</td><td></td><td style="text-align:right;">${formatPrice(totalCost)}</td>
         </tr>`;
  }

  function renderAnTopups(data) {
    const t = (data && data.totals) || { cash: 0, cashless: 0, total: 0, count: 0 };
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    set('anTopupsTotal', formatPrice(t.total));
    set('anTopupsCash', formatPrice(t.cash));
    set('anTopupsCashless', formatPrice(t.cashless));
    set('anTopupsCount', String(t.count || 0));
    const tbody = document.querySelector('#anTopupsTable tbody');
    if (!tbody) return;
    const days = (data && data.by_day) || [];
    if (!days.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="table-empty">Пополнений за период нет</td></tr>';
      return;
    }
    tbody.innerHTML = days.map((d) => `
      <tr>
        <td>${escapeHtml(String(d.day).slice(0, 10))}</td>
        <td style="text-align:right;">${formatPrice(d.cash)}</td>
        <td style="text-align:right;">${formatPrice(d.cashless)}</td>
        <td style="text-align:right;font-weight:600;">${formatPrice(d.total)}</td>
      </tr>`).join('')
      + `<tr style="border-top:2px solid var(--border);font-weight:700;">
           <td>Итого</td>
           <td style="text-align:right;">${formatPrice(t.cash)}</td>
           <td style="text-align:right;">${formatPrice(t.cashless)}</td>
           <td style="text-align:right;">${formatPrice(t.total)}</td>
         </tr>`;
  }

  function renderMastersReport(masters) {
    const tbody = document.getElementById('mastersTableBody');
    const emptyEl = document.getElementById('mastersEmpty');
    if (!masters || masters.length === 0) {
      tbody.innerHTML = '';
      emptyEl.style.display = '';
      return;
    }
    emptyEl.style.display = 'none';

    // Summary KPIs
    const totalVisits = masters.reduce((s, m) => s + (m.visits || 0), 0);
    const totalRevenue = masters.reduce((s, m) => s + (m.revenue || 0), 0);
    const totalClients = masters.reduce((s, m) => s + (m.unique_clients || 0), 0);
    const overallAvgCheck = totalVisits > 0 ? Math.round(totalRevenue / totalVisits) : 0;
    document.getElementById('mkpiVisits').textContent = totalVisits;
    document.getElementById('mkpiRevenue').textContent = formatPrice(totalRevenue);
    document.getElementById('mkpiAvgCheck').textContent = formatPrice(overallAvgCheck);
    document.getElementById('mkpiClients').textContent = totalClients;

    tbody.innerHTML = masters.map((m, idx) => {
      const name = m.master_name || 'Без имени';
      const rating = m.avg_rating ? `${m.avg_rating} ★` : '—';
      const ratingColor = m.avg_rating >= 4 ? '#22c55e' : m.avg_rating >= 3 ? '#eab308' : m.avg_rating ? '#dc2626' : '#9ca3af';
      const serviceRows = (m.services || []).slice(0, 8).map(s =>
        `<tr style="background:#f8fafc;">
           <td style="padding:6px 16px 6px 32px;color:#6b7280;font-size:13px;">— ${escapeHtml(s.service_name)}</td>
           <td style="padding:6px 16px;text-align:right;color:#6b7280;font-size:13px;">${s.count}</td>
           <td style="padding:6px 16px;text-align:right;color:#6b7280;font-size:13px;">${formatPrice(s.revenue)}</td>
           <td colspan="4"></td>
         </tr>`
      ).join('');
      const detailId = `mdetail-${idx}`;
      return `
        <tr style="border-top:1px solid #f3f4f6;cursor:pointer;" onclick="toggleMasterDetail('${detailId}')">
          <td style="padding:13px 16px;font-weight:600;color:#1a1a2e;">
            <span style="margin-right:6px;font-size:11px;color:#9ca3af;" id="${detailId}-arrow">▶</span>
            ${escapeHtml(name)}
          </td>
          <td style="padding:13px 16px;text-align:right;">${m.visits}</td>
          <td style="padding:13px 16px;text-align:right;font-weight:600;color:#7c3aed;">${formatPrice(m.revenue)}</td>
          <td style="padding:13px 16px;text-align:right;">${formatPrice(m.avg_check)}</td>
          <td style="padding:13px 16px;text-align:right;">${m.unique_clients}</td>
          <td style="padding:13px 16px;text-align:right;color:${ratingColor};font-weight:600;">${rating}</td>
          <td style="padding:13px 8px;text-align:center;color:#6b7280;font-size:13px;">${m.no_shows}/${m.cancels}</td>
        </tr>
        <tbody id="${detailId}" style="display:none;">${serviceRows}</tbody>
      `;
    }).join('');
  }

  window.toggleMasterDetail = function(id) {
    const el = document.getElementById(id);
    const arrow = document.getElementById(id + '-arrow');
    if (!el) return;
    const open = el.style.display !== 'none';
    el.style.display = open ? 'none' : '';
    if (arrow) arrow.textContent = open ? '▶' : '▼';
  };

  document.getElementById('analyticsPeriodPills')?.addEventListener('click', (e) => {
    const pill = e.target.closest('.period-pill');
    if (!pill) return;
    analyticsPeriod = pill.dataset.period;
    document.querySelectorAll('#analyticsPeriodPills .period-pill').forEach((p) =>
      p.classList.toggle('active', p === pill));
    void loadAnalytics();
  });

  document.getElementById('analyticsTabPills')?.addEventListener('click', (e) => {
    const pill = e.target.closest('.tab-pill');
    if (!pill) return;
    analyticsTab = pill.dataset.tab;
    document.querySelectorAll('#analyticsTabPills .tab-pill').forEach((p) =>
      p.classList.toggle('active', p === pill));
    ['overview', 'masters', 'services', 'retention', 'products', 'topups'].forEach((t) => {
      const el = document.getElementById('anTab' + t.charAt(0).toUpperCase() + t.slice(1));
      if (el) el.style.display = analyticsTab === t ? '' : 'none';
    });
    void loadAnalytics();
  });

  function renderReviews({ items, stats }) {
    const listEl = document.getElementById('reviewsList');
    const emptyEl = document.getElementById('reviewsEmpty');
    const statsRow = document.getElementById('reviewsStatsRow');
    const avgBadge = document.getElementById('reviewsAvgBadge');

    if (stats && stats.total > 0) {
      statsRow.style.display = '';
      avgBadge.style.display = '';
      document.getElementById('rvStatTotal').textContent = stats.total;
      document.getElementById('rvStatAvg').textContent = stats.avg_rating ? `${stats.avg_rating} ★` : '—';
      document.getElementById('rvStatFive').textContent = stats.five_star;
      document.getElementById('rvStatLow').textContent = stats.low_star;
      avgBadge.textContent = `★ ${stats.avg_rating ?? '—'}`;
    }

    if (!items || items.length === 0) {
      listEl.innerHTML = '';
      emptyEl.style.display = '';
      return;
    }
    emptyEl.style.display = 'none';

    const STARS = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);
    const starColor = (n) => n >= 4 ? '#22c55e' : n === 3 ? '#eab308' : '#dc2626';

    listEl.innerHTML = items.map((r, idx) => {
      const borderTop = idx > 0 ? 'border-top:1px solid #f3f4f6;' : '';
      const replied = r.reply
        ? `<div style="margin-top:8px;padding:8px 12px;background:#f5f3ff;border-radius:8px;font-size:13px;">
             <span style="color:#7c3aed;font-weight:600;">Ответ владельца:</span>
             <span style="color:#374151;"> ${escapeHtml(r.reply)}</span>
           </div>` : '';
      const replyBtn = !r.reply && (currentUser?.role === 'owner' || currentUser?.role === 'admin')
        ? `<button onclick="openReviewReply('${r.id}')" style="margin-top:8px;font-size:12px;color:#7c3aed;background:none;border:none;cursor:pointer;padding:0;">Ответить</button>`
        : '';
      return `
        <div style="padding:16px 20px;${borderTop}">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
            <span style="font-size:16px;color:${starColor(r.rating)};font-weight:700;">${STARS(r.rating)}</span>
            <span style="font-size:13px;font-weight:600;color:#1a1a2e;">${escapeHtml(r.client_name || 'Клиент')}</span>
            <span style="font-size:12px;color:#9ca3af;margin-left:auto;">${new Date(r.created_at).toLocaleDateString('ru-RU')}</span>
          </div>
          ${r.master_name ? `<div style="font-size:12px;color:#6b7280;margin-bottom:4px;">Мастер: ${escapeHtml(r.master_name)}</div>` : ''}
          ${r.comment ? `<div style="font-size:14px;color:#374151;">${escapeHtml(r.comment)}</div>` : ''}
          ${replied}
          ${replyBtn}
        </div>`;
    }).join('');
  }

  // Reply modal (inline)
  window.openReviewReply = function(reviewId) {
    const reply = prompt('Введите ответ клиенту:');
    if (!reply || !reply.trim()) return;
    apiCall('PATCH', `/api/bookings/reviews/${reviewId}/reply`, { reply: reply.trim() })
      .then(r => { if (r.ok) loadAnalytics(); });
  };

  function renderRetention({ summary, at_risk }) {
    if (!summary) return;
    const pct = (n) => `${n ?? 0}%`;
    document.getElementById('anReturnRate').textContent = pct(summary.return_rate);
    document.getElementById('anAvgVisits').textContent = summary.avg_visits ?? '—';
    document.getElementById('anTotalClients').textContent = summary.total ?? 0;

    const total = Number(summary.total) || 1;
    const funnel = [
      { label: '1 визит (разовые)', count: summary.one_time, cls: 'an-bar-fill--red' },
      { label: '2–3 визита', count: summary.two_three, cls: 'an-bar-fill--yellow' },
      { label: '4+ визитов (лояльные)', count: summary.loyal, cls: '' },
    ];
    document.getElementById('anFunnel').innerHTML = funnel.map(({ label, count, cls }) => {
      const n = Number(count) || 0;
      const pctW = Math.round((n / total) * 100);
      return `<div class="an-bar-row" title="${label}: ${n}">
        <div class="an-bar-label">${label}</div>
        <div class="an-bar-track"><div class="an-bar-fill ${cls}" style="width:${pctW}%"></div></div>
        <div class="an-bar-val">${n} <span style="color:var(--muted);font-size:11px;">(${pctW}%)</span></div>
      </div>`;
    }).join('');

    const list = document.getElementById('anAtRiskList');
    const countEl = document.getElementById('anAtRiskCount');
    if (countEl) countEl.textContent = String(summary.at_risk_30 ?? 0);
    if (!at_risk || !at_risk.length) {
      list.innerHTML = '<div class="empty" style="padding:16px;">Все клиенты активны</div>';
      return;
    }
    list.innerHTML = at_risk.map((c) => {
      const phone = c.client_phone || '';
      const days = c.days_since;
      const urgency = days >= 90 ? 'badge-red' : days >= 60 ? 'badge-yellow' : 'badge-gray';
      return `<div class="row-item" style="gap:10px;">
        <div style="flex:1">
          <div class="row-name">${escapeHtml(c.client_name || phone)}</div>
          <div class="row-meta">${phone} · ${c.visits} визитов</div>
        </div>
        <span class="badge ${urgency}">${days} дн. назад</span>
        ${phone ? `<a href="https://wa.me/${phone.replace(/\D/g,'')}" target="_blank" rel="noopener" class="btn-ghost btn-xs" style="flex-shrink:0;">WA</a>` : ''}
      </div>`;
    }).join('');
  }

  function renderAnalyticsKpi(kpi) {
    if (!kpi) return;
    const revenue = Number(kpi.revenue) || 0;
    const sales = Number(kpi.sales_count) || 0;
    document.getElementById('anKpiRevenue').textContent = formatPrice(revenue);
    document.getElementById('anKpiSales').textContent = sales;
    document.getElementById('anKpiAvg').textContent = sales ? formatPrice(revenue / sales) : '—';
    document.getElementById('anKpiStatus').textContent =
      `${kpi.active_count} / ${kpi.canceled_count} отмен`;
  }

  function renderAnalyticsByDay(rows) {
    const el = document.getElementById('anByDay');
    if (!rows || !rows.length) { el.innerHTML = '<div class="an-empty">Нет данных</div>'; return; }
    const maxRev = Math.max(...rows.map((r) => r.revenue), 1);
    el.innerHTML = rows.map((r) => {
      const pct = Math.round((r.revenue / maxRev) * 100);
      const d = new Date(r.day + 'T00:00:00');
      const label = `${d.getDate()} ${MONTHS_RU_SHORT[d.getMonth()]}`;
      return `<div class="an-bar-row" title="${label}: ${formatPrice(r.revenue)} (${r.sales} продаж)">
        <div class="an-bar-label">${label}</div>
        <div class="an-bar-track"><div class="an-bar-fill" style="width:${pct}%"></div></div>
        <div class="an-bar-val">${formatPrice(r.revenue)}</div>
      </div>`;
    }).join('');
  }

  function renderAnalyticsTopServices(rows) {
    const tbody = document.querySelector('#anTopServices tbody');
    if (!rows || !rows.length) {
      tbody.innerHTML = '<tr><td colspan="3" class="table-empty">Нет данных</td></tr>'; return;
    }
    tbody.innerHTML = rows.map((r) => `<tr>
      <td>${escapeHtml(r.service_name)}</td>
      <td class="text-right" style="color:var(--text-dim)">${r.bookings_count}×</td>
      <td class="text-right"><strong>${formatPrice(r.revenue)}</strong></td>
    </tr>`).join('');
  }

  function renderAnalyticsByMaster(rows) {
    const el = document.getElementById('anByMaster');
    if (!rows || !rows.length) { el.innerHTML = '<div class="an-empty">Нет данных</div>'; return; }
    const maxRev = Math.max(...rows.map((r) => r.revenue), 1);
    const masterMap = new Map(cachedMasters.map((m) => [m.id, m.display_name]));
    el.innerHTML = rows.map((r) => {
      const pct = Math.round((r.revenue / maxRev) * 100);
      const name = masterMap.get(r.master_id) || 'Неизвестный';
      return `<div class="an-master-row" title="${name}: ${formatPrice(r.revenue)}">
        <div class="an-master-name">${escapeHtml(name)}</div>
        <div class="an-bar-track" style="flex:1"><div class="an-bar-fill" style="width:${pct}%"></div></div>
        <div class="an-bar-val">${formatPrice(r.revenue)}</div>
      </div>`;
    }).join('');
  }

  // ===== SALES =====

  const PAYMENT_LABELS = { cash: 'Наличные', card: 'Карта', online: 'Онлайн', balance: 'С баланса' };

  let salesPeriod = 'today';
  let salesCurrentBookingId = null;
  let salesCurrentBookingPrice = 0;
  let salesCurrentClientId = null;
  let salesCurrentClientPhone = null;
  let salesCurrentBonusBalance = 0;

  function getSalesRange(period) {
    const today = todayLocalISO();
    if (period === 'today')  return { from: today, to: today };
    if (period === 'week') {
      const d = new Date(today + 'T00:00:00');
      d.setDate(d.getDate() - 6);
      return { from: d.toISOString().slice(0, 10), to: today };
    }
    if (period === 'month') {
      const d = new Date(today + 'T00:00:00');
      return { from: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`, to: today };
    }
    if (period === 'year') {
      const d = new Date(today + 'T00:00:00');
      return { from: `${d.getFullYear()}-01-01`, to: today };
    }
    return { from: today, to: today };
  }

  async function activateSalesView() {
    await loadSales();
  }

  async function loadSales() {
    const { from, to } = getSalesRange(salesPeriod);
    const { ok, data } = await apiCall('GET', `/api/bookings/sales?from=${from}&to=${to}`);
    if (!ok) return;
    renderSalesKpi(data.totals, data.items);
    renderSalesTable(data.items);
  }

  function renderSalesKpi(totals, items) {
    const revenue = totals?.revenue || 0;
    const count = totals?.count || 0;
    document.getElementById('salesKpiRevenue').textContent = formatPrice(revenue);
    document.getElementById('salesKpiCount').textContent = count;
    document.getElementById('salesKpiAvg').textContent = count ? formatPrice(revenue / count) : '—';
    const byCash   = items.filter((i) => i.payment_method === 'cash').reduce((a, i) => a + i.paid_amount, 0);
    const byCard   = items.filter((i) => i.payment_method === 'card').reduce((a, i) => a + i.paid_amount, 0);
    const byOnline = items.filter((i) => i.payment_method === 'online').reduce((a, i) => a + i.paid_amount, 0);
    document.getElementById('salesKpiMethods').textContent =
      `${formatPrice(byCash)} / ${formatPrice(byCard)} / ${formatPrice(byOnline)}`;
  }

  function renderSalesTable(items) {
    const tbody = document.getElementById('salesTableBody');
    if (!items.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="table-empty">Продаж за период нет</td></tr>';
      return;
    }
    tbody.innerHTML = items.map((s) => {
      const services = (s.services || []).map((sv) => escapeHtml(sv.service_name)).join(', ');
      const dt = new Date(s.completed_at);
      const dateStr = dt.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });
      const timeStr = `${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`;
      const client = escapeHtml(s.client_name || s.client_phone || '—');
      const method = PAYMENT_LABELS[s.payment_method] || s.payment_method || '—';
      const discount = s.discount_pct > 0 ? `${s.discount_pct}%` : '—';
      return `<tr>
        <td style="white-space:nowrap">${dateStr} ${timeStr}</td>
        <td>${client}</td>
        <td style="color:var(--text-dim);font-size:13px">${services || '—'}</td>
        <td><span class="pill pill-${s.payment_method === 'cash' ? 'ok' : s.payment_method === 'card' ? 'info' : 'warn'}">${method}</span></td>
        <td class="text-right">${discount}</td>
        <td class="text-right"><strong>${formatPrice(s.paid_amount)}</strong></td>
      </tr>`;
    }).join('');
  }

  // ===== Sale modal (complete booking) =====
  function updateSaleTotal() {
    const pct = Math.min(100, Math.max(0, Number(document.getElementById('saleDiscount')?.value) || 0));
    const afterDiscount = salesCurrentBookingPrice * (1 - pct / 100);
    const bonusSpend = Math.min(
      Number(els.saleBonusSpend?.value) || 0,
      salesCurrentBonusBalance,
      salesCurrentBookingPrice * (loadBonusSettings().max_spend_pct / 100),
    );
    _saleCertSpend = Math.min(_saleCertBalance, Math.max(0, afterDiscount - bonusSpend));
    const finalTotal = Math.max(0, afterDiscount - bonusSpend - _saleCertSpend);
    document.getElementById('saleTotalDisplay').textContent = formatPrice(finalTotal);
    if (els.saleBonusHint && salesCurrentBonusBalance > 0) {
      const maxBonus = Math.floor(salesCurrentBookingPrice * loadBonusSettings().max_spend_pct / 100);
      els.saleBonusHint.textContent = `Доступно: ${formatPrice(salesCurrentBonusBalance)} · Макс. ${loadBonusSettings().max_spend_pct}% от чека = ${formatPrice(Math.min(maxBonus, salesCurrentBonusBalance))}`;
    }
  }

  async function openSaleModal(bookingId, bookingPrice, servicesHtml, clientId, clientPhone) {
    salesCurrentBookingId = bookingId;
    salesCurrentBookingPrice = bookingPrice;
    salesCurrentClientId = clientId || null;
    salesCurrentClientPhone = clientPhone || null;
    salesCurrentBonusBalance = 0;
    document.getElementById('saleModalServices').innerHTML = servicesHtml;
    document.getElementById('saleDiscount').value = '0';
    if (els.salePromoCode) els.salePromoCode.value = '';
    if (els.salePromoMsg) els.salePromoMsg.textContent = '';
    if (els.saleBonusSpend) els.saleBonusSpend.value = '0';
    // Hide bonus section by default, show if client has bonuses
    if (els.saleBonusSection) els.saleBonusSection.hidden = true;
    const bonusSettings = loadBonusSettings();
    if (bonusSettings.accrual_rate > 0 || bonusSettings.max_spend_pct > 0) {
      // Try to find client bonus balance
      let balance = 0;
      if (clientId) {
        const found = clientsState.items.find((c) => c.id === clientId);
        if (found) balance = Number(found.bonus_balance || 0);
      }
      if (!balance && clientPhone) {
        const r = await apiCall('GET', `/api/clients?search=${encodeURIComponent(clientPhone)}&limit=1`);
        if (r.ok && r.data?.items?.length) balance = Number(r.data.items[0].bonus_balance || 0);
        if (balance > 0 && !salesCurrentClientId) salesCurrentClientId = r.data.items[0].id;
      }
      salesCurrentBonusBalance = balance;
      if (balance > 0 && bonusSettings.max_spend_pct > 0) {
        if (els.saleBonusSection) els.saleBonusSection.hidden = false;
        if (els.saleBonusBalance) els.saleBonusBalance.textContent = formatPrice(balance) + ' бонусов';
      }
    }
    updateSaleTotal();
    document.getElementById('saleModalBackdrop').hidden = false;
    document.getElementById('saleModal').hidden = false;
  }

  function closeSaleModal() {
    document.getElementById('saleModalBackdrop').hidden = true;
    document.getElementById('saleModal').hidden = true;
    salesCurrentBookingId = null;
    salesCurrentClientId = null;
    salesCurrentBonusBalance = 0;
  }

  document.getElementById('saleDiscount')?.addEventListener('input', updateSaleTotal);
  els.saleBonusSpend?.addEventListener('input', updateSaleTotal);

  document.getElementById('saleForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!salesCurrentBookingId) return;
    const method = document.getElementById('salePaymentMethod').value;
    const discountPct = Number(document.getElementById('saleDiscount').value) || 0;
    const promoCode = els.salePromoCode?.value?.trim().toUpperCase() || undefined;
    const btn = document.getElementById('saleModalSubmit');
    btn.disabled = true; btn.textContent = 'Проводим…';

    const bonusSettings = loadBonusSettings();
    const bonusSpend = Math.min(
      Number(els.saleBonusSpend?.value) || 0,
      salesCurrentBonusBalance,
      salesCurrentBookingPrice * (bonusSettings.max_spend_pct / 100),
    );
    const paidAmount = salesCurrentBookingPrice * (1 - discountPct / 100) - bonusSpend;
    const bonusAccrual = Math.floor(Math.max(0, paidAmount) * (bonusSettings.accrual_rate / 100));

    const { ok, data } = await apiCall('POST', `/api/bookings/${salesCurrentBookingId}/complete`, {
      payment_method: method,
      discount_pct: discountPct,
      ...(promoCode ? { promo_code: promoCode } : {}),
      bonus_spend: Math.round(bonusSpend * 100) / 100,
      bonus_accrual: bonusAccrual,
    });

    btn.disabled = false; btn.textContent = 'Провести оплату';

    if (!ok) {
      toast('Ошибка: ' + (data?.error || 'неизвестная ошибка'));
      return;
    }
    // Update client bonus balance
    const clientIdForBonus = salesCurrentClientId;
    const oldBalance = salesCurrentBonusBalance;
    if (clientIdForBonus && (bonusSpend > 0 || bonusAccrual > 0)) {
      const newBalance = Math.max(0, oldBalance - bonusSpend) + bonusAccrual;
      void apiCall('PATCH', `/api/clients/${clientIdForBonus}`, { bonus_balance: newBalance });
    }
    // Redeem certificate if used
    if (_saleCertId && _saleCertSpend > 0) {
      void finApi('POST', `/certificates/${_saleCertId}/redeem`, {
        amount: _saleCertSpend,
        booking_id: salesCurrentBookingId,
      });
    }
    closeSaleModal();
    closeBookingModal();
    // Refresh journal and sales
    void loadBookings();
    if (currentView === 'sales') void loadSales();
  });

  document.getElementById('saleModalClose')?.addEventListener('click', closeSaleModal);
  document.getElementById('saleModalCancel')?.addEventListener('click', closeSaleModal);
  document.getElementById('saleModalBackdrop')?.addEventListener('click', closeSaleModal);

  // Wire "Оформить продажу" button inside bk-modal
  document.getElementById('bkModalComplete')?.addEventListener('click', () => {
    if (!_bkModalCurrent) return;
    const b = _bkModalCurrent;
    const servicesHtml = (b.services || [])
      .map((s) => `<div>${escapeHtml(s.service_name)} — <strong>${formatPrice(s.price)}</strong></div>`)
      .join('') || '<div>Услуги не указаны</div>';
    void openSaleModal(b.id, b.total_price || 0, servicesHtml, b.client_id, b.client_phone);
  });

  // Sales period pills
  document.getElementById('salesPeriodPills')?.addEventListener('click', (e) => {
    const pill = e.target.closest('.period-pill');
    if (!pill) return;
    salesPeriod = pill.dataset.period;
    document.querySelectorAll('#salesPeriodPills .period-pill').forEach((p) =>
      p.classList.toggle('active', p === pill));
    void loadSales();
  });

  // ===== Promotion (promo codes) =====
  let cachedPromos = [];

  async function activatePromotionView() {
    await loadPromos();
  }

  async function loadPromos() {
    const { ok, data } = await apiCall('GET', '/api/bookings/promos');
    if (!ok) return;
    cachedPromos = data.items || [];
    renderPromos();
  }

  function renderPromos() {
    if (!els.promosCounter) return;
    els.promosCounter.textContent = String(cachedPromos.length);
    if (!cachedPromos.length) {
      els.promosList.innerHTML = '<div class="empty">Промокодов пока нет. Создайте первый!</div>';
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    els.promosList.innerHTML = cachedPromos.map((p) => {
      const expired = p.valid_to && p.valid_to < today;
      const notStarted = p.valid_from && p.valid_from > today;
      const exhausted = p.max_uses != null && p.used_count >= p.max_uses;
      const inactive = !p.is_active;
      const statusCls = (expired || notStarted || exhausted || inactive) ? 'pill-mute' : 'pill-ok';
      const statusLabel = inactive ? 'выкл' : expired ? 'истёк' : notStarted ? 'не начат' : exhausted ? 'исчерпан' : 'активен';
      const period = [p.valid_from, p.valid_to].filter(Boolean).join(' — ') || 'бессрочно';
      const uses = p.max_uses != null ? `${p.used_count}/${p.max_uses}` : p.used_count;
      return `<div class="data-row promo-row" data-promo-id="${p.id}">
        <div class="promo-code-badge">${escapeHtml(p.code)}</div>
        <div class="promo-info">
          <div class="promo-name">${escapeHtml(p.name)}</div>
          <div class="promo-meta">${period} &middot; использований: ${uses}</div>
        </div>
        <div class="promo-discount">${p.discount_pct}%</div>
        <span class="pill ${statusCls}">${statusLabel}</span>
        <button class="btn-ghost btn-sm promo-edit-btn" data-id="${p.id}">Изменить</button>
      </div>`;
    }).join('');
    els.promosList.querySelectorAll('.promo-edit-btn').forEach((btn) => {
      btn.addEventListener('click', () => openPromoModal(btn.dataset.id));
    });
  }

  function openPromoModal(id) {
    els.promoFormError.hidden = true;
    els.promoForm.reset();
    if (id) {
      const p = cachedPromos.find((x) => x.id === id);
      if (!p) return;
      els.promoModalTitle.textContent = 'Редактировать промокод';
      els.promoId.value = p.id;
      els.promoCode.value = p.code;
      els.promoName.value = p.name;
      els.promoDiscount.value = p.discount_pct;
      els.promoFrom.value = p.valid_from || '';
      els.promoTo.value = p.valid_to || '';
      els.promoMaxUses.value = p.max_uses ?? '';
      els.promoDelete.hidden = false;
      els.promoSubmit.textContent = 'Сохранить';
    } else {
      els.promoModalTitle.textContent = 'Новый промокод';
      els.promoId.value = '';
      els.promoDelete.hidden = true;
      els.promoSubmit.textContent = 'Создать';
    }
    els.promoModalBackdrop.hidden = false;
    els.promoModal.hidden = false;
    setTimeout(() => els.promoCode.focus(), 50);
  }

  function closePromoModal() {
    els.promoModalBackdrop.hidden = true;
    els.promoModal.hidden = true;
  }

  async function submitPromoForm(e) {
    e.preventDefault();
    els.promoFormError.hidden = true;
    const id = els.promoId.value.trim();
    const body = {
      code: els.promoCode.value.trim().toUpperCase(),
      name: els.promoName.value.trim(),
      discount_pct: parseFloat(els.promoDiscount.value),
      valid_from: els.promoFrom.value || null,
      valid_to: els.promoTo.value || null,
      max_uses: els.promoMaxUses.value ? parseInt(els.promoMaxUses.value, 10) : null,
    };
    const res = id
      ? await apiCall('PATCH', `/api/bookings/promos/${id}`, body)
      : await apiCall('POST', '/api/bookings/promos', body);
    if (!res.ok) {
      const msg = res.data?.code === 'PROMO_CODE_EXISTS' ? 'Промокод с таким кодом уже существует'
                : res.data?.error || 'Ошибка сохранения';
      els.promoFormError.textContent = msg;
      els.promoFormError.hidden = false;
      return;
    }
    closePromoModal();
    await loadPromos();
  }

  async function deletePromo() {
    const id = els.promoId.value.trim();
    if (!id) return;
    if (!confirm('Удалить промокод?')) return;
    await apiCall('DELETE', `/api/bookings/promos/${id}`);
    closePromoModal();
    await loadPromos();
  }

  // Toggle promo in sale modal
  if (els.salePromoApply) {
    els.salePromoApply.addEventListener('click', async () => {
      const code = els.salePromoCode.value.trim().toUpperCase();
      if (!code) return;
      const res = await apiCall('GET', `/api/bookings/promos/check?code=${encodeURIComponent(code)}`);
      if (!res.ok) {
        const msg = res.data?.code === 'PROMO_NOT_FOUND' ? 'Промокод не найден'
                  : res.data?.code === 'PROMO_EXPIRED'   ? 'Промокод истёк'
                  : res.data?.code === 'PROMO_INACTIVE'  ? 'Промокод неактивен'
                  : res.data?.code === 'PROMO_EXHAUSTED' ? 'Лимит использований исчерпан'
                  : res.data?.code === 'PROMO_NOT_STARTED' ? 'Акция ещё не началась'
                  : 'Промокод недействителен';
        els.salePromoMsg.style.color = 'var(--danger)';
        els.salePromoMsg.textContent = msg;
        return;
      }
      const p = res.data;
      els.saleDiscount.value = Math.max(parseFloat(els.saleDiscount.value) || 0, p.discount_pct);
      els.salePromoMsg.style.color = 'var(--success, #16a34a)';
      els.salePromoMsg.textContent = `✓ «${p.name}» — скидка ${p.discount_pct}% применена`;
      els.saleDiscount.dispatchEvent(new Event('input'));
    });
  }

  if (els.promoAddBtn) els.promoAddBtn?.addEventListener('click', () => openPromoModal(null));
  if (els.promoModalClose) els.promoModalClose.addEventListener('click', closePromoModal);
  if (els.promoModalBackdrop) els.promoModalBackdrop.addEventListener('click', closePromoModal);
  if (els.promoCancel) els.promoCancel.addEventListener('click', closePromoModal);
  if (els.promoDelete) els.promoDelete.addEventListener('click', deletePromo);
  if (els.promoForm) els.promoForm.addEventListener('submit', submitPromoForm);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && els.promoModal && !els.promoModal.hidden) closePromoModal();
  });

  // Also send promo_code when completing booking via sale modal
  // (handled inside submitSaleForm — need to pass salePromoCode.value)

  // ===== WhatsApp Settings Panel =====
  let waPollingTimer = null;

  async function loadWaStatus() {
    const badge = document.getElementById('waStatusBadge');
    const qrWrap = document.getElementById('waQrWrap');
    const qrImg = document.getElementById('waQrImg');
    const readyMsg = document.getElementById('waReadyMsg');
    const testMode = document.getElementById('waTestMode');
    if (!badge) return;

    const r = await apiCall('GET', '/api/whatsapp/status');
    if (!r.ok) {
      badge.className = 'pill pill-danger';
      badge.textContent = 'Ошибка';
      return;
    }
    const s = r.data;

    if (s.test_mode) {
      badge.className = 'pill pill-mute';
      badge.textContent = 'Тест-режим';
      if (qrWrap) qrWrap.hidden = true;
      if (readyMsg) readyMsg.hidden = true;
      if (testMode) testMode.hidden = false;
      return;
    }

    if (s.ready) {
      badge.className = 'pill pill-success';
      badge.textContent = 'Подключён';
      if (qrWrap) qrWrap.hidden = true;
      if (readyMsg) readyMsg.hidden = false;
      if (testMode) testMode.hidden = true;
      clearInterval(waPollingTimer);
      waPollingTimer = null;
      return;
    }

    badge.className = 'pill pill-warn';
    badge.textContent = s.status === 'qr_pending' ? 'Ожидание QR' : s.status || 'Инициализация';
    if (readyMsg) readyMsg.hidden = true;
    if (testMode) testMode.hidden = true;

    // fetch QR
    const qrRes = await apiCall('GET', '/api/whatsapp/qr');
    if (qrRes.ok) {
      const qd = qrRes.data;
      if (qd.qr && qrWrap && qrImg) {
        qrImg.src = qd.qr;
        qrWrap.hidden = false;
      } else if (qrWrap) {
        qrWrap.hidden = true;
      }
    }

    // start polling if not already
    if (!waPollingTimer) {
      waPollingTimer = setInterval(() => { void loadWaStatus(); }, 5000);
    }
  }

  document.getElementById('waRefreshBtn')?.addEventListener('click', () => { void loadWaStatus(); });

  document.getElementById('waRestartBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('waRestartBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Перезапуск…'; }
    try {
      await apiCall('POST', '/api/whatsapp/restart');
      clearInterval(waPollingTimer);
      waPollingTimer = null;
      await loadWaStatus();
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Перезапустить'; }
    }
  });

  // load WA status when navigating to notifications tab
  document.querySelectorAll('[data-tab="notifications"]').forEach((btn) => {
    btn.addEventListener('click', () => { void loadWaStatus(); });
  });

  // ===== Messages / WhatsApp Broadcast =====
  const SEGMENT_LABELS = {
    sleeping: 'Спящие (3+ мес.)',
    missing:  'Пропавшие (6+ мес.)',
    regular:  'Постоянные',
    new:      'Новые',
    never:    'Не посещали',
    all:      'Все клиенты',
  };

  let _broadcastRecipients = []; // [{phone, name}]

  async function loadBroadcastSegment() {
    const seg = document.getElementById('broadcastSegment')?.value || 'sleeping';
    const countEl = document.getElementById('broadcastCount');
    if (countEl) countEl.textContent = '…';

    const { ok, data } = await apiCall('GET', `/api/clients?segment=${seg}&limit=2000`);
    if (!ok) { if (countEl) countEl.textContent = '?'; return; }

    const clients = data?.items || [];
    _broadcastRecipients = clients
      .filter((c) => c.phone)
      .map((c) => ({ phone: c.phone, name: (c.full_name || '').split(' ')[0] || 'клиент' }));

    if (countEl) countEl.textContent = String(_broadcastRecipients.length);
    updateBroadcastPreview();
  }

  function updateBroadcastPreview() {
    const msg = document.getElementById('broadcastMessage')?.value || '';
    const charEl = document.getElementById('broadcastCharCount');
    if (charEl) charEl.textContent = `${msg.length} символов`;

    const wrap = document.getElementById('broadcastPreviewWrap');
    const textEl = document.getElementById('broadcastPreviewText');
    if (!wrap || !textEl) return;
    if (!msg.trim() || _broadcastRecipients.length === 0) { wrap.hidden = true; return; }
    const first = _broadcastRecipients[0];
    textEl.textContent = msg.replace(/\{name\}/g, first?.name || 'клиент');
    wrap.hidden = false;
  }

  async function sendBroadcast() {
    const msg = document.getElementById('broadcastMessage')?.value?.trim();
    const segEl = document.getElementById('broadcastSegment');
    const seg = segEl?.value || 'sleeping';
    const btn = document.getElementById('broadcastSendBtn');
    const resultEl = document.getElementById('broadcastResult');
    const progressEl = document.getElementById('broadcastProgress');
    const progressBar = document.getElementById('broadcastProgressBar');
    const progressLabel = document.getElementById('broadcastProgressLabel');

    if (!msg) { toast('Напишите сообщение'); return; }
    if (_broadcastRecipients.length === 0) { toast('Нет клиентов в выбранном сегменте с номером телефона'); return; }
    if (!confirm(`Отправить рассылку ${_broadcastRecipients.length} клиентам (${SEGMENT_LABELS[seg] || seg})?`)) return;

    if (btn) { btn.disabled = true; btn.textContent = 'Отправка…'; }
    if (resultEl) resultEl.hidden = true;
    if (progressEl) progressEl.hidden = false;
    if (progressBar) progressBar.style.width = '0%';
    if (progressLabel) progressLabel.textContent = `0 / ${_broadcastRecipients.length}`;

    const startedAt = new Date();
    try {
      const { ok, data, status } = await apiCall('POST', '/api/whatsapp/broadcast', {
        recipients: _broadcastRecipients,
        message: msg,
      });

      if (progressBar) progressBar.style.width = '100%';
      if (progressLabel) {
        progressLabel.textContent = ok
          ? `Готово: ${data.sent} / ${data.total}`
          : `Ошибка (${status})`;
      }

      if (resultEl) {
        resultEl.hidden = false;
        if (ok) {
          const hasFail = data.failed_count > 0;
          resultEl.className = `broadcast-result ${hasFail ? 'partial' : 'success'}`;
          resultEl.textContent = hasFail
            ? `Отправлено ${data.sent} из ${data.total}. Не доставлено: ${data.failed_count}.`
            : `Рассылка завершена. Отправлено ${data.sent} сообщений.`;
        } else {
          resultEl.className = 'broadcast-result error';
          resultEl.textContent = data?.error || data?.message || `Ошибка сервера (${status})`;
        }
      }

      // Append to history
      if (ok) addBroadcastHistory(seg, _broadcastRecipients.length, data.sent, data.failed_count, startedAt);

    } catch (e) {
      if (resultEl) { resultEl.hidden = false; resultEl.className = 'broadcast-result error'; resultEl.textContent = e.message; }
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Отправить рассылку'; }
    }
  }

  function addBroadcastHistory(seg, total, sent, failedCount, startedAt) {
    const histEl = document.getElementById('broadcastHistory');
    if (!histEl) return;
    const emptyEl = histEl.querySelector('.empty');
    if (emptyEl) emptyEl.remove();

    const timeStr = startedAt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    const dateStr = startedAt.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
    const item = document.createElement('div');
    item.className = 'broadcast-hist-item';
    item.innerHTML = `
      <div class="broadcast-hist-head">
        <span class="broadcast-hist-seg">${escapeHtml(SEGMENT_LABELS[seg] || seg)}</span>
        <span class="broadcast-hist-time">${dateStr}, ${timeStr}</span>
      </div>
      <div class="broadcast-hist-stats">
        Отправлено: <b>${sent}</b> / ${total}
        ${failedCount > 0 ? `<span class="fail"> · Не доставлено: ${failedCount}</span>` : ''}
      </div>
    `;
    histEl.insertBefore(item, histEl.firstChild);
  }

  // Wire up events
  document.getElementById('broadcastSegment')?.addEventListener('change', () => { void loadBroadcastSegment(); });
  document.getElementById('broadcastMessage')?.addEventListener('input', updateBroadcastPreview);
  document.getElementById('broadcastPreviewBtn')?.addEventListener('click', updateBroadcastPreview);
  document.getElementById('broadcastSendBtn')?.addEventListener('click', () => { void sendBroadcast(); });

  // Load WA status badge in messages view
  async function loadWaBroadcastStatus() {
    const badge = document.getElementById('waBroadcastStatusBadge');
    if (!badge) return;
    try {
      const r = await apiCall('GET', '/api/whatsapp/status');
      if (!r.ok) { badge.className = 'pill pill-danger'; badge.textContent = 'WA недоступен'; return; }
      const s = r.data;
      if (s.test_mode) { badge.className = 'pill pill-mute'; badge.textContent = 'Тест-режим'; }
      else if (s.ready) { badge.className = 'pill pill-success'; badge.textContent = 'WhatsApp подключён'; }
      else { badge.className = 'pill pill-warn'; badge.textContent = 'WA не подключён'; }
    } catch { badge.className = 'pill pill-danger'; badge.textContent = 'Ошибка'; }
  }

  // Hook into setView to load data when navigating to messages
  const _origSetView = setView;
  setView = function(v) {
    _origSetView(v);
    if (v === 'messages') {
      void loadWaBroadcastStatus();
      void loadBroadcastSegment();
    }
  };

  // ===== Init =====
  renderAuth();
  setView('profile');
  probeBackend();
  setInterval(probeBackend, 10000);
})();
