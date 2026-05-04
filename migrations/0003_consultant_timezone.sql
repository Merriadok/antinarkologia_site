-- Добавляем поле часового пояса консультанта
ALTER TABLE consultants ADD COLUMN timezone TEXT NOT NULL DEFAULT 'Europe/Moscow';
