(() => {
  'use strict';

  const els = {
    stepServices: document.getElementById('stepServices'),
    stepMasters: document.getElementById('stepMasters'),
    stepDate: document.getElementById('stepDate'),
    stepSlots: document.getElementById('stepSlots'),
    stepContacts: document.getElementById('stepContacts'),
    servicesList: document.getElementById('servicesList'),
    mastersList: document.getElementById('mastersList'),
    dateInput: document.getElementById('dateInput'),
    slotsList: document.getElementById('slotsList'),
    slotsHint: document.getElementById('slotsHint'),
    bookForm: document.getElementById('bookForm'),
    summary: document.getElementById('summary'),
    sumServices: document.getElementById('sumServices'),
    sumMaster: document.getElementById('sumMaster'),
    sumWhen: document.getElementById('sumWhen'),
    sumTotal: document.getElementById('sumTotal'),
    successScreen: document.getElementById('successScreen'),
    okWhen: document.getElementById('okWhen'),
    okServices: document.getElementById('okServices'),
    okMaster: document.getElementById('okMaster'),
    okTotal: document.getElementById('okTotal'),
    error: document.getElementById('error'),
  };

  // Состояние
  const state = {
    services: [],            // загруженные services
    masters: [],             // загруженные masters
    selectedServices: new Set(),
    selectedMaster: null,
    selectedDate: '',
    selectedSlot: null,      // { starts_at, ends_at }
    slots: [],
  };

  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function formatPrice(p) {
    const n = Number(p);
    if (!isFinite(n)) return '—';
    return n.toLocaleString('ru-RU') + ' ₽';
  }

  function stringToColor(s) {
    let h = 0;
    for (let i = 0; i < (s || '').length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return `hsl(${h % 360} 60% 55%)`;
  }

  function formatTime(iso) {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  function formatDateRu(date) {
    if (!date) return '—';
    const d = new Date(date + 'T00:00:00');
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  function todayLocalISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function showError(msg) {
    els.error.textContent = msg;
    els.error.hidden = false;
    setTimeout(() => { els.error.hidden = true; }, 6000);
  }

  async function api(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  // ===== Step 1: Services =====
  async function loadServices() {
    try {
      const data = await api('/api/salons/public/services');
      state.services = data.items || [];
      renderServices();
    } catch (e) {
      els.servicesList.innerHTML = '<div class="w-loading">Не удалось загрузить услуги.</div>';
    }
  }

  function renderServices() {
    if (state.services.length === 0) {
      els.servicesList.innerHTML = '<div class="w-loading">Услуг пока нет.</div>';
      return;
    }
    els.servicesList.innerHTML = state.services.map((s) => `
      <div class="w-item ${state.selectedServices.has(s.id) ? 'selected' : ''}" data-id="${s.id}">
        <div class="w-item-check"></div>
        <div class="w-item-color" style="background: ${escapeHtml(s.color || '#7c3aed')}"></div>
        <div class="w-item-main">
          <div class="w-item-name">${escapeHtml(s.name)}</div>
          <div class="w-item-meta">${escapeHtml(s.category_name || '')} · ${s.duration_minutes} мин</div>
        </div>
        <div class="w-item-stat">${formatPrice(s.price)}</div>
      </div>
    `).join('');

    els.servicesList.querySelectorAll('.w-item').forEach((el) => {
      el.addEventListener('click', () => {
        const id = el.dataset.id;
        if (state.selectedServices.has(id)) state.selectedServices.delete(id);
        else state.selectedServices.add(id);
        renderServices();
        updateSummary();
        if (state.selectedServices.size > 0) showStep('masters');
        else hideFrom('masters');
      });
    });
  }

  // ===== Step 2: Masters =====
  async function loadMasters() {
    try {
      const data = await api('/api/salons/public/masters');
      state.masters = data.items || [];
      renderMasters();
    } catch (e) {
      els.mastersList.innerHTML = '<div class="w-loading">Не удалось загрузить мастеров.</div>';
    }
  }

  function renderMasters() {
    if (state.masters.length === 0) {
      els.mastersList.innerHTML = '<div class="w-loading">Мастеров пока нет.</div>';
      return;
    }
    els.mastersList.innerHTML = state.masters.map((m) => {
      const initial = (m.display_name || '?')[0].toUpperCase();
      return `
        <div class="w-item ${state.selectedMaster === m.id ? 'selected' : ''}" data-id="${m.id}">
          <div class="w-item-check"></div>
          <div class="w-item-avatar" style="background: ${stringToColor(m.id)}">${escapeHtml(initial)}</div>
          <div class="w-item-main">
            <div class="w-item-name">${escapeHtml(m.display_name)}</div>
            <div class="w-item-meta">${escapeHtml(m.specialization || '')}</div>
          </div>
        </div>
      `;
    }).join('');

    els.mastersList.querySelectorAll('.w-item').forEach((el) => {
      el.addEventListener('click', () => {
        state.selectedMaster = el.dataset.id;
        state.selectedSlot = null;
        renderMasters();
        updateSummary();
        showStep('date');
        if (!state.selectedDate) {
          state.selectedDate = todayLocalISO();
          els.dateInput.value = state.selectedDate;
        }
        void loadSlots();
        showStep('slots');
      });
    });
  }

  // ===== Step 3: Date =====
  function initDate() {
    if (!state.selectedDate) {
      state.selectedDate = todayLocalISO();
      els.dateInput.value = state.selectedDate;
      els.dateInput.min = state.selectedDate;
    } else {
      els.dateInput.value = state.selectedDate;
    }
    els.dateInput.addEventListener('change', () => {
      state.selectedDate = els.dateInput.value;
      state.selectedSlot = null;
      updateSummary();
      void loadSlots();
    });
  }

  // ===== Step 4: Slots =====
  async function loadSlots() {
    if (!state.selectedMaster || state.selectedServices.size === 0 || !state.selectedDate) return;
    els.slotsList.innerHTML = '<div class="w-loading">Загрузка слотов…</div>';
    els.slotsHint.textContent = '';
    const ids = Array.from(state.selectedServices).join(',');
    try {
      const data = await api(`/api/bookings/slots?master_id=${state.selectedMaster}&date=${state.selectedDate}&service_ids=${encodeURIComponent(ids)}`);
      state.slots = data.items || [];
      renderSlots(data.meta);
    } catch (e) {
      els.slotsList.innerHTML = '<div class="w-loading">Не удалось загрузить слоты.</div>';
    }
  }

  function renderSlots(meta) {
    if (!state.slots.length) {
      els.slotsList.innerHTML = '<div class="w-loading">На эту дату свободных окон нет. Выберите другой день.</div>';
      els.slotsHint.textContent = meta?.schedule === 'day_off_or_missing'
        ? 'Мастер не работает в этот день.'
        : '';
      return;
    }
    els.slotsHint.textContent = `Длительность: ${meta?.total_duration_minutes || 0} мин`;
    els.slotsList.innerHTML = state.slots.map((s) => `
      <div class="w-slot ${state.selectedSlot?.starts_at === s.starts_at ? 'selected' : ''}" data-starts="${s.starts_at}" data-ends="${s.ends_at}">
        ${formatTime(s.starts_at)}
      </div>
    `).join('');

    els.slotsList.querySelectorAll('.w-slot').forEach((el) => {
      el.addEventListener('click', () => {
        state.selectedSlot = {
          starts_at: el.dataset.starts,
          ends_at: el.dataset.ends,
        };
        renderSlots(meta);
        updateSummary();
        showStep('contacts');
      });
    });
  }

  // ===== Step 5: Submit =====
  els.bookForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    els.error.hidden = true;

    if (!state.selectedSlot || !state.selectedMaster || state.selectedServices.size === 0) {
      showError('Заполни все шаги выше.');
      return;
    }

    const fd = new FormData(els.bookForm);
    const body = {
      master_id: state.selectedMaster,
      service_ids: Array.from(state.selectedServices),
      starts_at: state.selectedSlot.starts_at,
      client_name: String(fd.get('client_name') || '').trim(),
      client_phone: String(fd.get('client_phone') || '').trim(),
    };
    const notes = String(fd.get('notes') || '').trim();
    if (notes) body.notes = notes;

    if (!body.client_name || !body.client_phone) {
      showError('Имя и телефон обязательны.');
      return;
    }

    const submitBtn = els.bookForm.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Записываем…';

    let res;
    try {
      res = await fetch('/api/bookings/public/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (e) {
      showError('Сетевая ошибка. Проверьте соединение.');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Записаться';
      return;
    }

    submitBtn.disabled = false;
    submitBtn.textContent = 'Записаться';

    if (!res.ok) {
      let data = null;
      try { data = await res.json(); } catch {}
      if (res.status === 409 && data?.code === 'SLOT_TAKEN') {
        showError('К сожалению, это время только что забронировали. Выберите другое.');
        await loadSlots();
        return;
      }
      showError(`Ошибка: ${data?.error || res.status}`);
      return;
    }

    const data = await res.json();
    showSuccess(data);
  });

  function showSuccess(booking) {
    // Скрыть всё
    [els.stepServices, els.stepMasters, els.stepDate, els.stepSlots, els.stepContacts, els.summary]
      .forEach((el) => { if (el) el.hidden = true; });
    els.successScreen.hidden = false;

    const date = new Date(booking.starts_at);
    const dateStr = date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
    els.okWhen.textContent = `${dateStr}, ${formatTime(booking.starts_at)}–${formatTime(booking.ends_at)}`;
    els.okServices.textContent = (booking.services || []).map((s) => s.service_name).join(', ');
    const master = state.masters.find((m) => m.id === state.selectedMaster);
    els.okMaster.textContent = master?.display_name || '—';
    els.okTotal.textContent = formatPrice(booking.total_price);
  }

  // ===== Step visibility =====
  function showStep(step) {
    const order = ['masters', 'date', 'slots', 'contacts'];
    const idx = order.indexOf(step);
    if (idx < 0) return;
    for (let i = 0; i <= idx; i++) {
      const el = document.getElementById('step' + order[i].charAt(0).toUpperCase() + order[i].slice(1));
      if (el) el.hidden = false;
    }
  }
  function hideFrom(step) {
    const order = ['masters', 'date', 'slots', 'contacts'];
    const idx = order.indexOf(step);
    if (idx < 0) return;
    for (let i = idx; i < order.length; i++) {
      const el = document.getElementById('step' + order[i].charAt(0).toUpperCase() + order[i].slice(1));
      if (el) el.hidden = true;
    }
    els.summary.hidden = true;
  }

  // ===== Summary =====
  function updateSummary() {
    const services = state.services.filter((s) => state.selectedServices.has(s.id));
    if (services.length === 0) {
      els.summary.hidden = true;
      return;
    }
    els.summary.hidden = false;
    els.sumServices.textContent = services.map((s) => s.name).join(', ');

    const master = state.masters.find((m) => m.id === state.selectedMaster);
    els.sumMaster.textContent = master?.display_name || '—';

    if (state.selectedSlot) {
      const dateStr = formatDateRu(state.selectedDate);
      els.sumWhen.textContent = `${dateStr}, ${formatTime(state.selectedSlot.starts_at)}`;
    } else if (state.selectedDate) {
      els.sumWhen.textContent = formatDateRu(state.selectedDate);
    } else {
      els.sumWhen.textContent = '—';
    }

    const total = services.reduce((acc, s) => acc + Number(s.price), 0);
    const dur = services.reduce((acc, s) => acc + Number(s.duration_minutes), 0);
    els.sumTotal.textContent = `${formatPrice(total)} · ${dur} мин`;
  }

  // ===== Init =====
  initDate();
  void loadServices();
  void loadMasters();
})();
