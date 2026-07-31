// Разбор CSV для импорта клиентов. Чистые функции без состояния.

// Разделитель определяется по первой строке (запятая / точка с запятой / таб —
// Excel в русской локали сохраняет с «;»). Кавычки экранируют разделители
// и переводы строк внутри поля.
export function parseCsv(text) {
  const raw = text.replace(/^﻿/, '');           // BOM от Excel
  const first = raw.split('\n')[0] || '';
  const delim = first.includes(';') ? ';' : first.includes('\t') ? '\t' : ',';
  const rows = [];
  let inQuotes = false; let cur = ''; let row = [];
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '"') { inQuotes = !inQuotes; }
    else if (!inQuotes && ch === delim) { row.push(cur.trim()); cur = ''; }
    else if (!inQuotes && (ch === '\n' || (ch === '\r' && raw[i + 1] === '\n'))) {
      if (ch === '\r') i++;
      row.push(cur.trim()); rows.push(row); row = []; cur = '';
    } else { cur += ch; }
  }
  if (cur || row.length) {
    row.push(cur.trim());
    if (row.some(Boolean)) rows.push(row);
  }
  return rows;
}

// Сопоставление заголовков файла с полями клиента — по подстроке, чтобы
// «Номер телефона», «Phone number» и «тел.» попадали в phone.
const HEADER_MATCHES = {
  phone: ['телефон', 'phone', 'тел', 'tel', 'mobile'],
  full_name: ['имя', 'name', 'fullname', 'полноеимя', 'фио', 'клиент'],
  email: ['email', 'почта', 'mail', 'емейл'],
  gender: ['пол', 'gender', 'sex'],
  birthday: ['деньрождения', 'датарождения', 'birthday', 'born', 'dob'],
  comment: ['комментарий', 'примечание', 'comment', 'note', 'notes', 'заметка'],
};

export function detectColumnMap(headers) {
  const map = {};
  const norm = (s) => s.toLowerCase().replace(/[^а-яёa-z0-9]/gi, '');
  headers.forEach((h, idx) => {
    const n = norm(h);
    for (const [field, candidates] of Object.entries(HEADER_MATCHES)) {
      if (!(field in map) && candidates.some((c) => n.includes(c))) map[field] = idx;
    }
  });
  return map;
}
