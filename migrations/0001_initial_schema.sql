-- ============================================================
-- АНТИНАРКОЛОГИЯ — Полная схема БД
-- Версия: 0001 (начальная)
-- ============================================================

-- ------------------------------------------------------------
-- ПОЛЬЗОВАТЕЛИ (клиенты)
-- Три режима авторизации:
--   1. OAuth (vk/google/yandex) — auth_provider + external_id
--   2. Email + пароль           — email + password_hash
--   3. Анонимный                — только login + password_hash, email NULL
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Идентификация (всё опционально — зависит от режима входа)
  login           TEXT,                          -- для анонимного входа
  email           TEXT,                          -- для email-входа и уведомлений
  phone           TEXT,                          -- опционально, для справки
  display_name    TEXT,                          -- как обращаться (необязательно)

  -- Пароль (для email и анонимного режимов)
  password_hash   TEXT,

  -- OAuth
  auth_provider   TEXT,                          -- 'google' | 'vk' | 'yandex' | NULL
  external_id     TEXT,                          -- id от провайдера

  -- Мессенджеры (для показа ссылки консультанту)
  telegram_username   TEXT,                      -- @username или t.me/...
  vk_profile          TEXT,                      -- ссылка на профиль ВК
  max_profile         TEXT,                      -- ссылка в МаксиМессенджере (Макс)

  -- Настройки
  notify_email    INTEGER NOT NULL DEFAULT 1,    -- слать ли уведомления на email
  is_anonymous    INTEGER NOT NULL DEFAULT 0,    -- анонимный режим (нет email)

  -- Системные
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at    TEXT,

  -- Ограничения уникальности (только там, где значение есть)
  UNIQUE (email),
  UNIQUE (login),
  UNIQUE (auth_provider, external_id)
);

CREATE INDEX IF NOT EXISTS idx_users_email    ON users(email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_login    ON users(login) WHERE login IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_provider ON users(auth_provider, external_id)
  WHERE auth_provider IS NOT NULL;


-- ------------------------------------------------------------
-- СЕССИИ ПОЛЬЗОВАТЕЛЕЙ
-- JWT или opaque-токены, хранимые в D1 для возможности отзыва
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    TEXT    NOT NULL UNIQUE,          -- SHA-256 от токена
  user_agent    TEXT,
  ip_address    TEXT,
  expires_at    TEXT    NOT NULL,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  revoked_at    TEXT                               -- NULL = активна
);

CREATE INDEX IF NOT EXISTS idx_sessions_user    ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token   ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);


-- ------------------------------------------------------------
-- КОНСУЛЬТАНТЫ
-- Пока один — Мандыбура, но структура готова для расширения
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS consultants (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  slug            TEXT    NOT NULL UNIQUE,        -- 'mandybura' — для URL
  full_name       TEXT    NOT NULL,
  short_name      TEXT    NOT NULL,               -- 'Андрей Васильевич'
  title           TEXT    NOT NULL,               -- должность/специализация
  bio_short       TEXT,                           -- 2-3 предложения для карточки
  bio_full        TEXT,                           -- полное описание
  photo_url       TEXT,                           -- URL фото
  email           TEXT,                           -- личная почта консультанта
  telegram_chat_id TEXT,                          -- для Telegram-уведомлений

  -- Форматы встреч, которые поддерживает этот консультант
  supports_telemost    INTEGER NOT NULL DEFAULT 1,
  supports_telegram    INTEGER NOT NULL DEFAULT 1,
  supports_phone       INTEGER NOT NULL DEFAULT 1,

  is_active       INTEGER NOT NULL DEFAULT 1,     -- 0 = скрыт на сайте
  sort_order      INTEGER NOT NULL DEFAULT 0,     -- порядок на странице

  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);


-- ------------------------------------------------------------
-- ТАРИФЫ (услуги)
-- Консультация (совет) и варианты сопровождения
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tariffs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  slug            TEXT    NOT NULL UNIQUE,        -- 'advice' | 'support_7d' | etc.
  name            TEXT    NOT NULL,               -- 'Совет'
  description     TEXT,
  price_rub       INTEGER NOT NULL,               -- цена в рублях (целое)
  duration_days   INTEGER,                        -- NULL = разовое, N = срок сопровождения
  is_advice       INTEGER NOT NULL DEFAULT 0,     -- это разовый "совет"
  is_support      INTEGER NOT NULL DEFAULT 0,     -- это сопровождение
  -- Сопровождение: доступно только из ЛК (после звонка с консультантом)
  lk_only         INTEGER NOT NULL DEFAULT 0,
  is_active       INTEGER NOT NULL DEFAULT 1,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);


-- ------------------------------------------------------------
-- СЛОТЫ (расписание консультанта)
-- Консультант создаёт доступные окна времени
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS slots (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  consultant_id   INTEGER NOT NULL REFERENCES consultants(id),
  starts_at       TEXT    NOT NULL,               -- ISO 8601, UTC: '2025-05-10T10:00:00Z'
  ends_at         TEXT    NOT NULL,               -- обычно starts_at + 60 мин
  is_available    INTEGER NOT NULL DEFAULT 1,     -- 0 = заблокирован вручную
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now')),

  UNIQUE (consultant_id, starts_at)               -- нет дублей
);

CREATE INDEX IF NOT EXISTS idx_slots_consultant   ON slots(consultant_id);
CREATE INDEX IF NOT EXISTS idx_slots_starts       ON slots(starts_at);
CREATE INDEX IF NOT EXISTS idx_slots_available    ON slots(is_available, starts_at);


-- ------------------------------------------------------------
-- БРОНИРОВАНИЯ (заявки на совет)
-- Привязаны к слоту, тарифу, пользователю и консультанту
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bookings (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id),
  consultant_id   INTEGER NOT NULL REFERENCES consultants(id),
  slot_id         INTEGER REFERENCES slots(id),   -- NULL если слот выбран не был
  tariff_id       INTEGER NOT NULL REFERENCES tariffs(id),

  -- Статус жизненного цикла
  status          TEXT NOT NULL DEFAULT 'pending_payment',
  -- Допустимые значения:
  --   pending_payment  — ждёт оплаты
  --   paid             — оплачено, ждёт встречи
  --   in_progress      — встреча идёт
  --   completed        — завершено
  --   cancelled        — отменено (клиентом или консультантом)
  --   refunded         — возврат

  -- Контактный вопрос / описание ситуации от клиента
  client_question TEXT,

  -- Формат встречи (выбирает клиент)
  meeting_format  TEXT,
  -- 'telemost' | 'telegram' | 'max' | 'phone'

  -- Ссылки / контакты для встречи (заполняются после оплаты)
  meeting_link    TEXT,                           -- ссылка на TeleМост или мессенджер
  client_contact  TEXT,                           -- telegram/max/телефон клиента

  -- Заметки консультанта (приватные)
  consultant_notes TEXT,

  -- Системные
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  cancelled_at    TEXT,
  cancelled_by    TEXT                            -- 'user' | 'consultant'
);

CREATE INDEX IF NOT EXISTS idx_bookings_user       ON bookings(user_id);
CREATE INDEX IF NOT EXISTS idx_bookings_consultant ON bookings(consultant_id);
CREATE INDEX IF NOT EXISTS idx_bookings_slot       ON bookings(slot_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status     ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_created    ON bookings(created_at);


-- ------------------------------------------------------------
-- ПЛАТЕЖИ
-- Привязаны к бронированию; один платёж = одно бронирование
-- Хранят данные от ЮKassa для верификации webhook
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payments (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id      INTEGER NOT NULL UNIQUE REFERENCES bookings(id),

  -- ЮKassa
  yukassa_payment_id  TEXT UNIQUE,               -- id от ЮKassa ('2a...')
  yukassa_status      TEXT,                      -- 'pending'|'waiting_for_capture'|'succeeded'|'canceled'
  payment_method      TEXT,                      -- 'bank_card' | 'sbp' | etc.
  amount_rub          INTEGER NOT NULL,          -- сумма в рублях
  currency            TEXT NOT NULL DEFAULT 'RUB',

  -- Подтверждение
  confirmation_url    TEXT,                      -- redirect-URL для клиента
  paid_at             TEXT,                      -- когда подтверждён платёж
  refunded_at         TEXT,

  -- Сырой ответ от ЮKassa (для отладки)
  raw_response        TEXT,

  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_payments_booking  ON payments(booking_id);
CREATE INDEX IF NOT EXISTS idx_payments_yukassa  ON payments(yukassa_payment_id);


-- ------------------------------------------------------------
-- СОПРОВОЖДЕНИЕ (активные периоды)
-- Создаётся вручную консультантом после договорённости с клиентом
-- Клиент видит кнопку оплаты в ЛК
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS support_contracts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id),
  consultant_id   INTEGER NOT NULL REFERENCES consultants(id),
  tariff_id       INTEGER NOT NULL REFERENCES tariffs(id),

  -- Статус
  status          TEXT NOT NULL DEFAULT 'awaiting_payment',
  -- 'awaiting_payment' | 'active' | 'completed' | 'cancelled'

  starts_at       TEXT,                           -- заполняется после оплаты
  ends_at         TEXT,                           -- starts_at + duration_days

  -- Условия (консультант может скорректировать цену индивидуально)
  custom_price_rub INTEGER,                       -- если NULL — берём из tariffs.price_rub
  consultant_comment TEXT,                        -- что обсудили, для клиента

  -- Платёж за сопровождение
  payment_id      INTEGER REFERENCES payments(id),

  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_support_user       ON support_contracts(user_id);
CREATE INDEX IF NOT EXISTS idx_support_consultant ON support_contracts(consultant_id);
CREATE INDEX IF NOT EXISTS idx_support_status     ON support_contracts(status);


-- ------------------------------------------------------------
-- УВЕДОМЛЕНИЯ (лог)
-- Все отправленные уведомления — для отладки и истории
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER REFERENCES users(id),   -- NULL если для консультанта
  consultant_id   INTEGER REFERENCES consultants(id), -- NULL если для клиента
  booking_id      INTEGER REFERENCES bookings(id),

  channel         TEXT NOT NULL,                  -- 'email' | 'telegram' | 'browser'
  type            TEXT NOT NULL,
  -- Типы:
  --   booking_created      — бронь создана (до оплаты)
  --   payment_success      — оплата прошла
  --   booking_reminder     — напоминание за 24ч и 1ч
  --   booking_cancelled    — отмена
  --   support_offer        — консультант предложил сопровождение
  --   support_paid         — сопровождение оплачено

  subject         TEXT,                           -- тема письма
  body            TEXT,                           -- текст сообщения
  sent_at         TEXT,                           -- NULL = ещё не отправлено
  error           TEXT,                           -- текст ошибки если failed

  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notifications_user     ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_booking  ON notifications(booking_id);
CREATE INDEX IF NOT EXISTS idx_notifications_sent     ON notifications(sent_at);


-- ------------------------------------------------------------
-- НАЧАЛЬНЫЕ ДАННЫЕ
-- ------------------------------------------------------------

-- Консультант: Андрей Васильевич Мандыбура
INSERT OR IGNORE INTO consultants (
  slug, full_name, short_name, title,
  bio_short, bio_full,
  photo_url,
  supports_telemost, supports_telegram, supports_phone,
  is_active, sort_order
) VALUES (
  'mandybura',
  'Мандыбура Андрей Васильевич',
  'Андрей Васильевич',
  'Эксперт в области зависимостей',
  'Более 20 лет практики. Помогает разобраться в ситуации и найти выход — без осуждения и без лишней бюрократии.',
  'Андрей Васильевич Мандыбура — специалист с многолетним опытом работы с темой зависимостей. Работал в международных программах, участвовал в проектах по реабилитации в Крыму. Подход — доказательный, человечный, без навешивания ярлыков.',
  '/static/mandybura.jpg',
  1, 1, 1,
  1, 0
);

-- Тарифы
INSERT OR IGNORE INTO tariffs (slug, name, description, price_rub, duration_days, is_advice, is_support, lk_only, is_active, sort_order) VALUES
  ('advice',      'Совет',              'Один вопрос — один развёрнутый ответ. Разберёмся в ситуации вместе.',                    1000,  NULL, 1, 0, 0, 1, 0),
  ('support_7d',  'Сопровождение 7 дней',  'Неделя поддержки: связь, корректировка плана, ответы на новые вопросы.',             5000,  7,    0, 1, 1, 1, 1),
  ('support_1m',  'Сопровождение 1 месяц', 'Месяц работы: регулярный контакт, план действий, поддержка на каждом этапе.',        20000, 30,   0, 1, 1, 1, 2),
  ('support_3m',  'Сопровождение 3 месяца','Три месяца системной работы.',                                                        30000, 90,   0, 1, 1, 1, 3),
  ('support_5m',  'Сопровождение 5 месяцев','Полный курс сопровождения для сложных ситуаций.',                                   50000, 150,  0, 1, 1, 1, 4);
