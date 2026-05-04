// ============================================================
// Панель консультанта: управление слотами, записями, профилем
// ============================================================

import { Hono } from 'hono'
import { requireConsultant } from '../middleware/auth'
import { hashPassword } from '../lib/auth'
import type { Bindings, Variables } from '../types'

const consultant = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// GET /api/consultant/profile — профиль консультанта
consultant.get('/profile', requireConsultant, async (c) => {
  const profile = await c.env.DB
    .prepare('SELECT * FROM consultants WHERE is_active = 1 LIMIT 1')
    .first()
  return c.json({ profile })
})

// PATCH /api/consultant/profile — обновить профиль
consultant.patch('/profile', requireConsultant, async (c) => {
  const { bio_short, bio_full, title, telegram_chat_id, email,
          phone, telegram_url, max_url, timezone,
          supports_telemost, supports_telegram, supports_phone } = await c.req.json()

  const updates: string[] = ["updated_at = datetime('now')"]
  const values: any[] = []

  if (bio_short !== undefined)        { updates.push('bio_short = ?'); values.push(bio_short) }
  if (bio_full !== undefined)         { updates.push('bio_full = ?'); values.push(bio_full) }
  if (title !== undefined)            { updates.push('title = ?'); values.push(title) }
  if (telegram_chat_id !== undefined) { updates.push('telegram_chat_id = ?'); values.push(telegram_chat_id) }
  if (email !== undefined)            { updates.push('email = ?'); values.push(email) }
  if (supports_telemost !== undefined){ updates.push('supports_telemost = ?'); values.push(supports_telemost ? 1 : 0) }
  if (supports_telegram !== undefined){ updates.push('supports_telegram = ?'); values.push(supports_telegram ? 1 : 0) }
  if (supports_phone !== undefined)   { updates.push('supports_phone = ?'); values.push(supports_phone ? 1 : 0) }
  if (phone !== undefined)             { updates.push('phone = ?'); values.push(phone) }
  if (telegram_url !== undefined)      { updates.push('telegram_url = ?'); values.push(telegram_url) }
  if (max_url !== undefined)           { updates.push('max_url = ?'); values.push(max_url) }
  if (timezone !== undefined)          { updates.push('timezone = ?'); values.push(timezone) }

  values.push(1) // id консультанта

  await c.env.DB
    .prepare(`UPDATE consultants SET ${updates.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run()

  return c.json({ ok: true })
})

// GET /api/consultant/dashboard — общая статистика
consultant.get('/dashboard', requireConsultant, async (c) => {
  const [pending, paid, total, revenue] = await Promise.all([
    c.env.DB.prepare("SELECT COUNT(*) as cnt FROM bookings WHERE status = 'pending_payment'").first<{ cnt: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) as cnt FROM bookings WHERE status = 'paid'").first<{ cnt: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) as cnt FROM bookings").first<{ cnt: number }>(),
    c.env.DB.prepare("SELECT COALESCE(SUM(t.price_rub), 0) as total FROM bookings b JOIN tariffs t ON t.id = b.tariff_id WHERE b.status IN ('paid', 'completed')").first<{ total: number }>()
  ])

  // Ближайшие записи
  const upcoming = await c.env.DB
    .prepare(`
      SELECT b.id, b.status, b.meeting_format, b.meeting_link,
             b.client_question, b.client_contact,
             t.name as tariff_name,
             s.starts_at,
             u.display_name as client_name, u.email as client_email,
             u.telegram_username, u.max_profile
      FROM bookings b
      LEFT JOIN tariffs t ON t.id = b.tariff_id
      LEFT JOIN slots s ON s.id = b.slot_id
      LEFT JOIN users u ON u.id = b.user_id
      WHERE b.status = 'paid'
        AND (s.starts_at IS NULL OR s.starts_at >= datetime('now'))
      ORDER BY s.starts_at ASC NULLS LAST
      LIMIT 10
    `)
    .all()

  return c.json({
    stats: {
      pending: pending?.cnt || 0,
      paid: paid?.cnt || 0,
      total: total?.cnt || 0,
      revenue: revenue?.total || 0
    },
    upcoming: upcoming.results
  })
})

// POST /api/consultant/support-offer — предложить сопровождение клиенту
consultant.post('/support-offer', requireConsultant, async (c) => {
  const { user_id, tariff_id, custom_price_rub, consultant_comment } = await c.req.json()

  if (!user_id || !tariff_id) {
    return c.json({ error: 'user_id и tariff_id обязательны' }, 400)
  }

  const tariff = await c.env.DB
    .prepare('SELECT * FROM tariffs WHERE id = ? AND is_support = 1')
    .bind(tariff_id)
    .first()

  if (!tariff) return c.json({ error: 'Тариф сопровождения не найден' }, 404)

  const result = await c.env.DB
    .prepare(`
      INSERT INTO support_contracts
        (user_id, consultant_id, tariff_id, status, custom_price_rub, consultant_comment)
      VALUES (?, 1, ?, 'awaiting_payment', ?, ?)
    `)
    .bind(user_id, tariff_id, custom_price_rub || null, consultant_comment || null)
    .run()

  return c.json({ ok: true, contractId: result.meta.last_row_id })
})

// GET /api/consultant/support-contracts — все контракты сопровождения
consultant.get('/support-contracts', requireConsultant, async (c) => {
  const result = await c.env.DB
    .prepare(`
      SELECT sc.*,
             t.name as tariff_name, t.price_rub as tariff_price,
             u.display_name as client_name, u.email as client_email
      FROM support_contracts sc
      JOIN tariffs t ON t.id = sc.tariff_id
      LEFT JOIN users u ON u.id = sc.user_id
      ORDER BY sc.created_at DESC
    `)
    .all()
  return c.json({ contracts: result.results })
})

// POST /api/consultant/setup — первичная настройка аккаунта консультанта
// Вызывается один раз при инициализации
consultant.post('/setup', async (c) => {
  const { setup_key, email, password } = await c.req.json()

  // Простой ключ настройки — должен совпадать с env
  const expectedKey = c.env.JWT_SECRET ? `setup-${c.env.JWT_SECRET.slice(0, 8)}` : 'setup-dev-key'
  if (setup_key !== expectedKey) {
    return c.json({ error: 'Неверный ключ настройки' }, 403)
  }

  const existing = await c.env.DB
    .prepare("SELECT id FROM users WHERE auth_provider = 'consultant'")
    .first()

  if (existing) {
    return c.json({ error: 'Аккаунт консультанта уже создан' }, 409)
  }

  const passwordHash = await hashPassword(password)

  await c.env.DB
    .prepare(`
      INSERT INTO users (email, password_hash, auth_provider, display_name, notify_email)
      VALUES (?, ?, 'consultant', 'Андрей Васильевич', 1)
    `)
    .bind(email, passwordHash)
    .run()

  return c.json({ ok: true, message: 'Аккаунт консультанта создан' })
})

export default consultant
