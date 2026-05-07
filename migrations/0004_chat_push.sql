-- ============================================================
-- Миграция 0004: Внутренний чат + Push-подписки
-- ============================================================

-- ------------------------------------------------------------
-- СООБЩЕНИЯ ЧАТА (клиент ↔ консультант)
-- Привязаны к конкретной записи (booking)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chat_messages (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id    INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  sender_type   TEXT    NOT NULL,    -- 'user' | 'consultant'
  sender_id     INTEGER NOT NULL,    -- user.id или consultant.id
  body          TEXT    NOT NULL,
  is_read       INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_chat_booking  ON chat_messages(booking_id);
CREATE INDEX IF NOT EXISTS idx_chat_created  ON chat_messages(booking_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_unread   ON chat_messages(booking_id, is_read);

-- ------------------------------------------------------------
-- PUSH-ПОДПИСКИ (Web Push / Service Worker)
-- Хранит endpoint + ключи для отправки уведомлений
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint      TEXT    NOT NULL,
  p256dh_key    TEXT    NOT NULL,   -- публичный ключ клиента
  auth_key      TEXT    NOT NULL,   -- auth-секрет
  user_agent    TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  last_used_at  TEXT,

  UNIQUE (user_id, endpoint)
);

CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);

-- ------------------------------------------------------------
-- Добавляем поле telemost_api_key в consultants (если нет)
-- для хранения ключа Яндекс TeleМост
-- ------------------------------------------------------------
ALTER TABLE consultants ADD COLUMN telemost_api_key TEXT;
ALTER TABLE consultants ADD COLUMN telemost_org_id   TEXT;
