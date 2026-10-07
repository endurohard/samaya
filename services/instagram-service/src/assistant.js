// Ответчик на базе LLM: читает входящее и готовит ответ от имени клиники.
//
// Главное решение модуля: по умолчанию он НЕ отправляет, а кладёт черновик.
// Клиника — медицинские услуги, и цена ошибки в автоответе несимметрична:
// неверно названная цена или намёк на показания к процедуре стоят дороже,
// чем задержка на минуту, пока администратор нажмёт «отправить».
// Автоотправка включается осознанно (INSTAGRAM_AI_AUTOSEND=true) и даже
// тогда работает только для тем из белого списка — см. CLASSIFY_PROMPT.
//
// Провайдер — любой с OpenAI-совместимым API (OpenAI, DeepSeek, локальный
// сервер, корпоративный прокси): задаётся базовым URL, чтобы не привязывать
// клинику к одному поставщику и к одной юрисдикции.
const API_BASE = (process.env.INSTAGRAM_AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
const API_KEY = process.env.INSTAGRAM_AI_API_KEY || '';
const MODEL = process.env.INSTAGRAM_AI_MODEL || 'gpt-4o-mini';
const AUTOSEND = process.env.INSTAGRAM_AI_AUTOSEND === 'true';
const ENABLED = process.env.INSTAGRAM_AI_ENABLED === 'true';
const TIMEOUT_MS = Number(process.env.INSTAGRAM_AI_TIMEOUT_MS || 25_000);

// Знания о клинике. Вынесены в переменную окружения, а не зашиты в код:
// услуги и цены меняются, и ради правки прайса не должна собираться новая
// версия образа.
const CLINIC_INFO = process.env.INSTAGRAM_AI_CLINIC_INFO || `
Клиника косметологии «Самая», Каспийск, ул. Ленина 18.
Запись и вопросы по телефону клиники.
`.trim();

const SYSTEM_PROMPT = `Ты — администратор клиники косметологии «Самая». Отвечаешь
клиентам в Instagram Direct от имени клиники.

СВЕДЕНИЯ О КЛИНИКЕ:
${CLINIC_INFO}

КАК ОТВЕЧАТЬ:
- По-русски, коротко (1–3 предложения), вежливо и на «вы».
- Без эмодзи-украшательств, без восклицаний через слово. Спокойный деловой тон.
- Если спрашивают цену или услугу, которой нет в сведениях выше, — НЕ выдумывай.
  Скажи, что уточнишь, и предложи записаться на консультацию.
- Никогда не давай медицинских рекомендаций, не называй показания и
  противопоказания, не оценивай, подойдёт ли процедура человеку, и не ставь
  диагнозов даже по фото. Это решает врач на очной консультации.
- Не обещай результат процедуры и сроки восстановления.
- Если человек просит записаться — уточни услугу и удобный день, скажи, что
  администратор подтвердит время.

ОТВЕТ: только текст сообщения клиенту, без пояснений и без кавычек.`;

// Классификатор. Нужен ровно для одного: решить, можно ли отправить ответ
// без человека. Отдельным вызовом, а не частью ответа, потому что смешанная
// задача («ответь и оцени себя») даёт модели повод занижать риск ради
// красивого ответа.
const CLASSIFY_PROMPT = `Ты классифицируешь входящее сообщение клиента клиники
косметологии. Верни ОДНО слово:

safe      — простой организационный вопрос: часы работы, адрес, как добраться,
            есть ли парковка, общий прайс, как записаться, приветствие.
escalate  — всё остальное: любые вопросы о здоровье, показаниях,
            противопоказаниях, подойдёт ли процедура, фото проблемы, жалобы,
            недовольство, возврат денег, споры о цене, вопросы о конкретном
            враче, срочность, а также всё, в чём ты не уверен.

Сомневаешься — отвечай escalate.`;

async function chat(messages, maxTokens = 300) {
  if (!API_KEY) throw new Error('INSTAGRAM_AI_API_KEY не задан');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`${API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        max_tokens: maxTokens,
        temperature: 0.3,
      }),
      signal: ctl.signal,
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      throw new Error(`LLM ${r.status}: ${t.slice(0, 200)}`);
    }
    const j = await r.json();
    const text = j.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('пустой ответ модели');
    return text;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Подготовить ответ на диалог.
 *
 * history — последние сообщения диалога в хронологическом порядке
 *           ([{from_me, body}]). Контекст обязателен: без него модель
 *           здоровается в середине переписки и переспрашивает то, что
 *           клиент уже написал.
 *
 * Возвращает { ok, draft, safe, autosend, reason }.
 * autosend=true означает «можно отправлять без человека» и требует
 * одновременно: включённой автоотправки, класса safe и непустого ответа.
 */
export async function prepareReply(history) {
  if (!ENABLED) return { ok: false, reason: 'ответчик выключен' };

  const incoming = [...history].reverse().find(m => !m.from_me);
  if (!incoming?.body) return { ok: false, reason: 'нет входящего текста' };

  // Классифицируем ДО генерации: если тема требует человека, тратить вызов
  // на ответ незачем — черновик всё равно будет перечитан администратором,
  // а на спорных темах его формулировка скорее мешает, чем помогает.
  let safe = false;
  try {
    const verdict = await chat([
      { role: 'system', content: CLASSIFY_PROMPT },
      { role: 'user', content: incoming.body.slice(0, 1500) },
    ], 10);
    safe = /^safe/i.test(verdict.trim());
  } catch (e) {
    // Классификатор недоступен — считаем небезопасным. Отказ в автоответе
    // при сбое безвреден, ошибочный автоответ — нет.
    console.error('[IG][ии] классификация не удалась:', e.message);
    safe = false;
  }

  const ctx = history.slice(-12).map(m => ({
    role: m.from_me ? 'assistant' : 'user',
    content: String(m.body || '').slice(0, 1000),
  })).filter(m => m.content);

  let draft;
  try {
    draft = await chat([{ role: 'system', content: SYSTEM_PROMPT }, ...ctx]);
  } catch (e) {
    return { ok: false, reason: e.message };
  }

  // Длина ответа. Direct технически примет и больше, но простыня от «живого
  // администратора» читается как бот сильнее любой формулировки.
  if (draft.length > 600) draft = draft.slice(0, 600).replace(/\s+\S*$/, '…');

  return {
    ok: true,
    draft,
    safe,
    autosend: AUTOSEND && safe,
    reason: safe ? null : 'тема требует администратора',
  };
}

export function aiStatus() {
  return {
    enabled: ENABLED,
    autosend: AUTOSEND,
    model: MODEL,
    base_url: API_BASE,
    has_key: !!API_KEY,
  };
}
