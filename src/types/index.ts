// ============================================================
// Типы для всего приложения
// ============================================================

export type Bindings = {
  DB: D1Database
  // Секреты (задаются через wrangler secret put)
  JWT_SECRET: string
  YUKASSA_SHOP_ID: string
  YUKASSA_SECRET_KEY: string
  EMAIL_FROM: string
  EMAIL_SMTP_URL: string          // smtp://user:pass@host:port
  EMAIL_ENABLED: string           // 'true' чтобы включить отправку писем (по умолчанию отключено)
  CONSULTANT_EMAIL: string
  CONSULTANT_TELEGRAM_BOT_TOKEN: string
  CONSULTANT_TELEGRAM_CHAT_ID: string
  BASE_URL: string                // https://antinarkologia.ru
  // Яндекс TeleМост (OAuth-токен сотрудника Яндекс 360)
  TELEMOST_API_KEY: string        // OAuth токен из Яндекс ID → Яндекс 360
  // Telegram-бот для чата и уведомлений
  TELEGRAM_BOT_TOKEN: string      // от @BotFather
  TELEGRAM_BOT_SECRET: string     // секрет для webhook-валидации
  // Push VAPID ключи (Web Push)
  VAPID_PUBLIC_KEY: string
  VAPID_PRIVATE_KEY: string
  VAPID_SUBJECT: string           // mailto:admin@antinarkologia.ru
}

export type Variables = {
  userId: number
  userRole: 'client' | 'consultant'
}

// ---- Модели из БД ----

export type User = {
  id: number
  login: string | null
  email: string | null
  phone: string | null
  display_name: string | null
  auth_provider: string | null
  external_id: string | null
  telegram_username: string | null
  vk_profile: string | null
  max_profile: string | null
  notify_email: number
  is_anonymous: number
  created_at: string
  last_seen_at: string | null
}

export type Consultant = {
  id: number
  slug: string
  full_name: string
  short_name: string
  title: string
  bio_short: string | null
  bio_full: string | null
  photo_url: string | null
  email: string | null
  telegram_chat_id: string | null
  supports_telemost: number
  supports_telegram: number
  supports_phone: number
  is_active: number
  sort_order: number
}

export type Tariff = {
  id: number
  slug: string
  name: string
  description: string | null
  price_rub: number
  duration_days: number | null
  is_advice: number
  is_support: number
  lk_only: number
  is_active: number
  sort_order: number
}

export type Slot = {
  id: number
  consultant_id: number
  starts_at: string
  ends_at: string
  is_available: number
  created_at: string
}

export type Booking = {
  id: number
  user_id: number
  consultant_id: number
  slot_id: number | null
  tariff_id: number
  status: BookingStatus
  client_question: string | null
  meeting_format: MeetingFormat | null
  meeting_link: string | null
  client_contact: string | null
  consultant_notes: string | null
  created_at: string
  updated_at: string
  cancelled_at: string | null
  cancelled_by: string | null
}

export type BookingStatus =
  | 'pending_payment'
  | 'paid'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'refunded'

export type MeetingFormat = 'telemost' | 'telegram' | 'max' | 'phone'

export type Payment = {
  id: number
  booking_id: number
  yukassa_payment_id: string | null
  yukassa_status: string | null
  payment_method: string | null
  amount_rub: number
  currency: string
  confirmation_url: string | null
  paid_at: string | null
  refunded_at: string | null
  created_at: string
}

export type SupportContract = {
  id: number
  user_id: number
  consultant_id: number
  tariff_id: number
  status: 'awaiting_payment' | 'active' | 'completed' | 'cancelled'
  starts_at: string | null
  ends_at: string | null
  custom_price_rub: number | null
  consultant_comment: string | null
  payment_id: number | null
  created_at: string
}
