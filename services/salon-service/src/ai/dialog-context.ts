// Контекст диалога для классификатора.
//
// Jev выбирает тему по одному сообщению клиента. Короткий ответ на вопрос
// клиники («Круговая», «Живот,талия», «О первой») сам по себе ничего не
// значит и уходил в manual_review, а опрос переспрашивал то, на что клиент
// уже ответил. Последняя реплика клиники объясняет, на что он отвечает.
import { pool } from '../db';

/** Сколько часов реплика клиники считается частью текущего разговора. */
const CONTEXT_HOURS = Number(process.env.AI_CONTEXT_HOURS || 12);

/**
 * Последняя текстовая реплика клиники в диалоге или null.
 *
 * Для Instagram берём переписку целиком, а не журнал ассистента: вопрос
 * мог задать менеджер или автоответ Instagram на рекламу («У нас есть два
 * варианта… О какой процедуре рассказать?») — их в журнале нет. Для прочих
 * каналов (пробный, Telegram) — последний отправленный ответ из журнала.
 */
export async function lastClinicMessage(
  companyId: string, channel: string, threadId: string,
): Promise<string | null> {
  const { rows } = channel === 'instagram'
    ? await pool.query(
      `SELECT body AS previous FROM instagram.messages
        WHERE company_id = $1 AND thread_id = $2 AND from_me
          AND coalesce(body, '') <> ''
          AND sent_at > now() - make_interval(hours => $3::int)
        ORDER BY sent_at DESC LIMIT 1`,
      [companyId, threadId, CONTEXT_HOURS])
    : await pool.query(
      `SELECT reply AS previous FROM ai.reply_log
        WHERE company_id = $1 AND channel = $2 AND thread_id = $3
          AND action = 'sent' AND coalesce(reply, '') <> ''
          AND created_at > now() - make_interval(hours => $4::int)
        ORDER BY created_at DESC LIMIT 1`,
      [companyId, channel, threadId, CONTEXT_HOURS]);
  return rows[0]?.previous ?? null;
}
