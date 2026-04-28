-- Добавляем контактные поля для консультанта
ALTER TABLE consultants ADD COLUMN phone          TEXT;  -- телефон для звонков
ALTER TABLE consultants ADD COLUMN telegram_url   TEXT;  -- ссылка t.me/username
ALTER TABLE consultants ADD COLUMN max_url        TEXT;  -- ссылка на профиль в Макс
