// Классификатор тем для шаблонных ответов.
//
// Почему Jev, а не обычная языковая модель: Jev — System One модель от
// TypeSafe AI, она не генерирует текст вообще, только выбирает вариант из
// закрытого списка и возвращает калиброванную вероятность. Для клиники это
// и есть гарантия «не выходить за шаблоны»: генератора текста в системе
// нет, поэтому выдумать цену или показание физически нечем. Ответ приходит
// за 150-500 мс и стоит доли цента, так что вызов на каждое входящее
// сообщение не требует ни своего железа, ни оглядки на бюджет.
//
// Вторая причина — вероятность. Обычная модель уверенно отвечает всегда;
// Jev на спорном сообщении («а липосакцию делаете? цена и кто врач»)
// возвращает низкую уверенность, и такое сообщение уходит человеку, а не
// получает шаблон не по теме.
import { pool } from '../db';
import { Agent, ProxyAgent } from 'undici';

const JEV_URL = (process.env.JEV_BASE_URL || 'https://api.typesafe.ai').replace(/\/$/, '');
const JEV_KEY = process.env.TYPESAFE_API_KEY || '';
const JEV_MODEL = process.env.JEV_MODEL || 'jev-latest';
const JEV_TIMEOUT_MS = Number(process.env.JEV_TIMEOUT_MS || 20_000);

// Классификатор ходит через egress-proxy (прямой выход), а НЕ через
// egress-proxy-vless, которым идут запросы к Meta. Требования двух внешних
// сервисов прямо противоположны:
//   Meta     — домены недоступны с прямого маршрута, и российский аккаунт
//              обязан выходить местным адресом, иначе блокировка;
//   TypeSafe — наоборот, отвечает 451 «not available in your region» на
//              российский адрес и штатно работает с адреса сервера.
// Замерено на бою: через порт 1080 (прямой) — HTTP 200 с 212.28.178.215,
// через 1087 (VLESS) — HTTP 451 с 176.98.155.17.
//
// Прокси обязателен, несмотря на слово «прямой»: у контейнеров этого
// сервера нет своего выхода в интернет, весь их трафик уходит российским
// адресом 176.98.155.17. Голландский адрес доступен только через мост
// egress-proxy, живущий в сети хоста.
//
// Отдельная ловушка: в окружении контейнера заданы системные HTTPS_PROXY и
// http_proxy, и undici подхватывает их молча, без единой строки в коде.
// Поэтому диспетчер задаётся ЯВНО — он перекрывает переменные окружения, а
// не полагается на их значение.
const JEV_PROXY = process.env.JEV_HTTP_PROXY || '';
const jevAgent = JEV_PROXY
  ? new ProxyAgent(JEV_PROXY)
  : new Agent({ connect: { timeout: 10_000 } });

// Порог уверенности для автоответа. 0.85 — значение по умолчанию самого
// Jev для «решать автоматически». Ниже порога сообщение уходит
// администратору, даже если тема формально определена.
const AUTO_MIN = Number(process.env.AI_AUTO_CONFIDENCE || 0.85);

export interface Template {
  id: string;
  topic: string;
  title: string;
  matcher: string;
  body: string;
  autosend: boolean;
}

export interface Decision {
  ok: boolean;
  topic: string | null;
  template: Template | null;
  confidence: number;
  // sent — можно отправлять без человека; draft — черновик администратору;
  // skipped — отвечать не нужно; failed — классификация не удалась.
  action: 'sent' | 'draft' | 'skipped' | 'failed';
  reply: string | null;
  reason: string | null;
  probabilities?: Record<string, number>;
}

export async function loadTemplates(companyId: string): Promise<Template[]> {
  const { rows } = await pool.query(
    `SELECT id, topic, title, matcher, body, autosend
       FROM ai.reply_templates
      WHERE company_id = $1 AND enabled = TRUE
      ORDER BY sort_order, title`,
    [companyId],
  );
  return rows;
}

/**
 * Определить тему входящего сообщения и подобрать ответ.
 *
 * clientName — имя клиента, если диалог связан с карточкой: подставляется
 * в {name}. Когда имени нет, плейсхолдер убирается вместе с лишним
 * пробелом, иначе клиент получит буквальное «Здравствуйте, {name}».
 */
export async function classify(
  companyId: string,
  text: string,
  clientName?: string | null,
): Promise<Decision> {
  const fail = (reason: string): Decision => ({
    ok: false, topic: null, template: null, confidence: 0,
    action: 'failed', reply: null, reason,
  });

  const message = String(text || '').trim();
  if (!message) return fail('пустое сообщение');
  if (!JEV_KEY) return fail('TYPESAFE_API_KEY не задан — классификатор недоступен');

  const templates = await loadTemplates(companyId);
  if (!templates.length) return fail('нет ни одного включённого шаблона');

  // Варианты для модели: ключ темы -> описание из шаблона. Плюс два
  // служебных, которых нет среди шаблонов.
  const criteria: Record<string, string> = {};
  for (const t of templates) criteria[t.topic] = t.matcher;

  // Спам отвечать не нужно вовсе — без этого варианта реклама попадёт в
  // ближайшую по смыслу тему и получит вежливый ответ клиники.
  criteria.spam = 'Реклама, предложение услуг клинике, продвижение, массовая рассылка, сотрудничество от чужих компаний. Отвечать не нужно.';
  // Явный запасной вариант. Без него модель вынуждена выбрать хоть
  // что-то и выбирает ближайшее по смыслу — ровно то, чего нельзя
  // допускать в клинике.
  criteria.manual_review = 'Сообщение не подходит ни под одну тему, непонятно сформулировано, содержит несколько разных вопросов сразу, или есть любое сомнение.';

  let answer: { choice?: string; confidence?: number; probabilities?: Record<string, number> };
  try {
    const r = await fetch(`${JEV_URL}/v1/systemone`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${JEV_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: JEV_MODEL,
        state: `Сообщение клиента в Instagram Direct клиники косметологии: "${message.slice(0, 1500)}"`,
        questions: { theme: { type: 'choice', criteria } },
      }),
      signal: AbortSignal.timeout(JEV_TIMEOUT_MS),
      // @ts-expect-error — dispatcher не описан в типах DOM fetch,
      // но поддерживается рантаймом Node (undici).
      dispatcher: jevAgent,
    });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      return fail(`классификатор ответил ${r.status}: ${body.slice(0, 200)}`);
    }
    const json = await r.json() as any;
    answer = json?.answers?.theme ?? {};
  } catch (e) {
    // Сбой классификатора не должен превращаться в молчание: сообщение
    // уходит администратору, просто без подсказки по теме.
    return fail(`классификатор недоступен: ${(e as Error).message}`);
  }

  const topic = answer.choice ?? null;
  const confidence = Number(answer.confidence ?? 0);
  const probabilities = answer.probabilities;

  if (!topic) return fail('классификатор не вернул тему');

  if (topic === 'spam') {
    return {
      ok: true, topic, template: null, confidence, probabilities,
      action: 'skipped', reply: null, reason: 'реклама — ответ не требуется',
    };
  }

  if (topic === 'manual_review') {
    return {
      ok: true, topic, template: null, confidence, probabilities,
      action: 'draft', reply: null,
      reason: 'тема не определена — нужен администратор',
    };
  }

  const template = templates.find(t => t.topic === topic) ?? null;
  if (!template) {
    // Модель вернула тему, которой нет среди шаблонов. Такое возможно,
    // если шаблон выключили между загрузкой и ответом.
    return {
      ok: true, topic, template: null, confidence, probabilities,
      action: 'draft', reply: null, reason: `шаблон темы «${topic}» не найден`,
    };
  }

  const reply = render(template.body, clientName);

  // Низкая уверенность — черновик, даже если тема разрешена к автоответу.
  // Порядок проверок важен: сначала уверенность, потом права темы, иначе
  // в причине окажется «тема требует администратора» там, где на самом
  // деле модель сомневалась.
  if (confidence < AUTO_MIN) {
    return {
      ok: true, topic, template, confidence, probabilities,
      action: 'draft', reply,
      reason: `низкая уверенность (${confidence.toFixed(2)}) — нужна проверка`,
    };
  }

  if (!template.autosend) {
    return {
      ok: true, topic, template, confidence, probabilities,
      action: 'draft', reply, reason: 'тема требует подтверждения администратором',
    };
  }

  return {
    ok: true, topic, template, confidence, probabilities,
    action: 'sent', reply, reason: null,
  };
}

/**
 * Подставить имя клиента. Единственная поддерживаемая подстановка: всё
 * остальное должно быть написано в шаблоне буквально, иначе теряется смысл
 * «бот не выходит за одобренный текст».
 */
export function render(body: string, clientName?: string | null): string {
  const name = (clientName || '').trim();
  if (name) return body.replace(/\{name\}/g, name);
  // Имени нет: убираем плейсхолдер вместе с запятой и лишним пробелом
  // перед ним, чтобы не осталось «Здравствуйте, !».
  return body.replace(/,?\s*\{name\}/g, '').replace(/\s{2,}/g, ' ').trim();
}

/** Записать решение в журнал. Ошибка записи не должна ломать ответ клиенту. */
export async function logDecision(
  companyId: string,
  d: Decision,
  opts: { channel?: string; threadId?: string | null; incoming: string },
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO ai.reply_log
         (company_id, channel, thread_id, incoming, topic, template_id,
          confidence, action, reply, reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        companyId, opts.channel ?? 'instagram', opts.threadId ?? null,
        opts.incoming.slice(0, 4000), d.topic, d.template?.id ?? null,
        Number.isFinite(d.confidence) ? d.confidence : null,
        d.action, d.reply, d.reason,
      ],
    );
  } catch (e) {
    console.error('[ai] не удалось записать журнал:', (e as Error).message);
  }
}
