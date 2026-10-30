-- 076_ai_template_shortcut.sql
--
-- Код быстрого шаблона: менеджер пишет в поле ответа «000» и получает
-- готовый текст вместо того, чтобы набирать его заново.
--
-- Код живёт у шаблона, а не отдельным справочником: тексты и так уже
-- лежат здесь, и второй список разъехался бы с первым при первой правке.
--
-- Уникальность в пределах компании: два шаблона с кодом «6» — это
-- молчаливая лотерея, какой подставится.

SET search_path TO ai, public;

ALTER TABLE ai.reply_templates
  ADD COLUMN IF NOT EXISTS shortcut text NULL;

-- Пустую строку приравниваем к «кода нет»: иначе несколько шаблонов с
-- пустым кодом нарушат уникальный индекс, и сохранение в админке начнёт
-- падать на ровном месте.
UPDATE ai.reply_templates SET shortcut = NULL WHERE shortcut = '';

CREATE UNIQUE INDEX IF NOT EXISTS reply_templates_shortcut_idx
  ON ai.reply_templates (company_id, shortcut)
  WHERE shortcut IS NOT NULL;
