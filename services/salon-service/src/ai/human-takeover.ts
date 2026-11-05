// Участвует ли в диалоге человек — тогда бот не отвечает сам.
//
// 4 ноября, в первый день без режима обкатки, бот ответил поверх менеджера в
// 138 диалогах из 287: менеджер представлялся или спрашивал вес, а бот следом
// слал приветствие или «уточните город». Ещё в десятках диалогов бот
// дублировал автоответ самого Instagram на рекламное сообщение. Ответ бота в
// таких диалогах остаётся черновиком для администратора.
import { pool } from '../db';

/** Сколько часов бот молчит после ручного сообщения менеджера. */
export const HUMAN_PAUSE_HOURS = Number(process.env.AI_HUMAN_PAUSE_HOURS || 12);

/** Подпись, которой instagram-service помечает сообщения бота в переписке. */
export const BOT_AUTHOR = 'Ассистент';

/**
 * Причина не отвечать автоматически или null, если можно.
 *
 * Сообщения бота узнаются двумя способами: по подписи «Ассистент» (её ставит
 * канал после отправки) и по совпадению с отправленным ответом в журнале —
 * второе покрывает переписку до появления подписи.
 *
 * Автоответ Instagram на рекламное сообщение приходит через 1–3 секунды после
 * реплики клиента и в журнале ассистента не значится. Ручным он не считается
 * (человек так быстро не пишет), иначе бот замолкал бы на каждом рекламном
 * диалоге. Но как «клиенту уже ответили» он учитывается — второй ответ на тот
 * же вопрос не нужен.
 *
 * Медиа без текста не учитываются: эхо отправленных ботом схем зон приходит
 * без подписи, а менеджер почти никогда не шлёт фото без слов.
 */
export async function humanTakeoverReason(
  companyId: string, threadId: string, hours = HUMAN_PAUSE_HOURS,
): Promise<string | null> {
  const { rows } = await pool.query(
    `WITH msgs AS (
       SELECT m.from_me, m.sent_at,
              m.from_me AND (
                -- coalesce обязателен: у ручных сообщений подписи нет, и
                -- NULL = 'Ассистент' даёт NULL, а NOT NULL отбрасывает строку
                -- целиком — проверка молча не видела ни одного менеджера.
                coalesce(m.author_name, '') = $4
                OR EXISTS (
                  SELECT 1 FROM ai.reply_log l
                   WHERE l.company_id = m.company_id AND l.channel = 'instagram'
                     AND l.thread_id = m.thread_id AND l.action = 'sent'
                     AND l.reply = m.body
                     AND l.created_at BETWEEN m.sent_at - interval '5 minutes'
                                          AND m.sent_at + interval '1 minute')
              ) AS bot,
              m.from_me AND EXISTS (
                SELECT 1 FROM instagram.messages c
                 WHERE c.company_id = m.company_id AND c.thread_id = m.thread_id
                   AND NOT c.from_me
                   AND c.sent_at BETWEEN m.sent_at - interval '10 seconds' AND m.sent_at
              ) AS instant
         FROM instagram.messages m
        WHERE m.company_id = $1 AND m.thread_id = $2
          AND m.sent_at > now() - make_interval(hours => $3::int)
          AND coalesce(m.body, '') <> ''
     )
     SELECT EXISTS (SELECT 1 FROM msgs WHERE from_me AND NOT bot AND NOT instant) AS human,
            coalesce((SELECT from_me FROM msgs WHERE NOT bot
                       ORDER BY sent_at DESC LIMIT 1), false) AS answered`,
    [companyId, threadId, Math.max(1, Math.round(hours)), BOT_AUTHOR],
  );
  const r = rows[0];
  if (r?.human) return `диалог ведёт администратор — бот не отвечает сам ${hours} ч после его сообщения`;
  if (r?.answered) return 'клиенту уже ответили после его сообщения — нужен администратор';
  return null;
}
