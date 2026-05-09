-- ============================================================
-- Миграция 0006: Предложение времени консультантом + email для анонимов
-- ============================================================

-- Поле для предложенного консультантом времени встречи
-- NULL = время не предложено
-- Клиент может принять (slot_id заполняется) или отклонить
ALTER TABLE bookings ADD COLUMN proposed_time TEXT;           -- ISO 8601
ALTER TABLE bookings ADD COLUMN proposed_time_status TEXT;   -- NULL | 'pending' | 'accepted' | 'declined'

-- Email для анонимных пользователей (опционально, они сами указывают)
-- Уже есть поле email в users, просто в профиле сделаем его доступным для анонимов

-- Индекс для поиска записей с предложенным временем
CREATE INDEX IF NOT EXISTS idx_bookings_proposed ON bookings(proposed_time_status)
  WHERE proposed_time_status IS NOT NULL;
