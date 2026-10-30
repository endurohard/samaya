-- 077_ai_shortcuts_seed.sql
--
-- Коды быстрых шаблонов по списку владельца.
--
-- Часть текстов в системе уже есть — им код просто проставляется. Для
-- остальных заводятся заготовки, ВЫКЛЮЧЕННЫЕ для ассистента: текст пишет
-- владелец в админке, а выдуманный мной текст ушёл бы клиенту от имени
-- клиники. Выключенная заготовка при этом доступна менеджеру по коду:
-- `enabled` управляет автоматикой, а не ручной подстановкой.
--
-- Вступление про ноги разбито на две темы ровно по нумерации владельца:
-- 6 — текст с просьбой прислать фото плюс две схемы зон, 66 — текст про
-- авторскую методику. Автоответ склеивает обе (см. ai/intro.ts): так у
-- менеджера есть обе части по отдельности, а у бота — связка целиком.

SET search_path TO ai, public;

-- ── Коды для уже существующих текстов ────────────────────────────────
UPDATE ai.reply_templates SET shortcut = '0'  WHERE topic = 'liposakciya_ruk' AND shortcut IS NULL;
UPDATE ai.reply_templates SET shortcut = '1'  WHERE topic = 'procedure_lipo'  AND shortcut IS NULL;
UPDATE ai.reply_templates SET shortcut = '3'  WHERE topic = 'price_chin'      AND shortcut IS NULL;

-- ── Вступление про ноги: вторая половина выносится в свою тему ────────
INSERT INTO ai.reply_templates (company_id, topic, title, matcher, body, autosend, enabled, sort_order, shortcut)
SELECT
  c.company_id,
  'legs_method',
  'Ноги: уникальная методика (7 зон)',
  'Служебная тема: не выбирается классификатором. Вторая часть вступления про круговую липосакцию ног.',
  E'Уникальная авторская методика, по которой мы работаем комплексно, равномерно прорабатывая все 7 зон ног, а не отдельные участки.\n'
  || E'\n'
  || E'Мы создаем плавные переходы без резких границ, чтобы сформировать красивый, гармоничный силуэт со всех сторон.\n'
  || E'\n'
  || E'При комплексной проработке меняется не только контур ног — ягодицы визуально становятся более округлыми, а силуэт приобретает более женственные пропорции.\n'
  || E'\n'
  || E'❗️Процедура проводится без общего наркоза и без тяжёлой реабилитации❗️\n'
  || E'\n'
  || E'После процедуры вы самостоятельно встаёте и уходите домой на своих уже худых ножках 💃\n'
  || E'\n'
  || E'Выше показали, какие именно 7 зон входят в процедуру 🤍',
  FALSE, TRUE, 911, '66'
FROM (SELECT DISTINCT company_id FROM ai.reply_templates) c
ON CONFLICT (company_id, topic) DO NOTHING;

-- legs_intro остаётся первой половиной: текст с просьбой прислать фото и
-- две схемы зон. Правка точечная, через replace по известному куску:
-- переписывать body целиком нельзя — владелец правит тексты между
-- выкладками, и INSERT ... DO UPDATE затёр бы его правки.
UPDATE ai.reply_templates
   SET body = substring(body FROM 1 FOR position(E'--- фото: legs-zones-back' IN body)
                                    + length(E'--- фото: legs-zones-back') - 1),
       shortcut = COALESCE(shortcut, '6')
 WHERE topic = 'legs_intro'
   AND position(E'--- фото: legs-zones-back' IN body) > 0;

-- ── Заготовки под остальные коды ─────────────────────────────────────
-- enabled = false: ассистент их не использует, пока владелец не впишет
-- текст и не включит тему. Менеджеру по коду они доступны сразу — он
-- увидит подсказку вместо текста и поймёт, что шаблон не заполнен.
INSERT INTO ai.reply_templates (company_id, topic, title, matcher, body, autosend, enabled, sort_order, shortcut)
SELECT c.company_id, v.topic, v.title,
       'Заготовка: опишите, при каком вопросе клиента применять эту тему.',
       '(текст не заполнен — впишите его в админке)',
       FALSE, FALSE, v.ord, v.code
FROM (SELECT DISTINCT company_id FROM ai.reply_templates) c
CROSS JOIN (VALUES
  ('ready_soon',      'Рассматривают ближайшее время / просто цена', 1000, '00'),
  ('price_all_zones', 'Цены на все зоны',                            1001, '000'),
  ('which_messenger', 'В каком мессенджере продолжить',              1002, '0000'),
  ('leave_on_own',    'После ЛЛ уходят самостоятельно',              1003, '11'),
  ('which_city',      'В каком городе написать цену',                1004, '111'),
  ('ask_questions',   'Если есть вопросы — спрашивайте',             1005, '2'),
  ('to_whatsapp',     'Удобно ли перейти в WhatsApp',                1006, '22'),
  ('contour_lift',    'Contour Lift',                                1007, '33'),
  ('holka_shoulders', 'Холка с плечиками',                           1008, '333'),
  ('price_arms',      'Цена на руки',                                1009, '4'),
  ('arms_interest',   'Стоимость на руки интересует',                1010, '44'),
  ('price_belly',     'Живот',                                       1011, '5')
) AS v(topic, title, ord, code)
ON CONFLICT (company_id, topic) DO NOTHING;
