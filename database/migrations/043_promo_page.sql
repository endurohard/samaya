-- 043_promo_page.sql
--
-- Общая публичная страница акции (в дополнение к индивидуальным купонам):
--   public_token — токен ссылки /promo/a/<token> для массовых каналов
--                  (пост, сторис, рассылка одной ссылкой);
--   page_views   — счётчик переходов по ссылке акции.
-- Посетитель, оставивший телефон на странице акции, получает свой
-- promo_coupon (status=claimed) — так набирается аудитория.

SET search_path TO bookings, public;

ALTER TABLE promotions
  ADD COLUMN IF NOT EXISTS public_token TEXT,
  ADD COLUMN IF NOT EXISTS page_views INT NOT NULL DEFAULT 0;

-- Бэкфилл токенов существующим акциям
UPDATE promotions
SET public_token = encode(gen_random_bytes(9), 'hex')
WHERE public_token IS NULL;

ALTER TABLE promotions ALTER COLUMN public_token SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_promotions_public_token ON promotions(public_token);
