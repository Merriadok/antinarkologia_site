-- ============================================================
-- Миграция 0005: telegram_bot_chat_id для клиентов
-- Сохраняет Telegram chat_id клиента когда он пишет боту
-- ============================================================

ALTER TABLE users ADD COLUMN telegram_bot_chat_id TEXT;

CREATE INDEX IF NOT EXISTS idx_users_tg_bot_chat ON users(telegram_bot_chat_id)
  WHERE telegram_bot_chat_id IS NOT NULL;
