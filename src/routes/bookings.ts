// ============================================================
// Роуты бронирований: создание, список, управление
// ============================================================

import { Hono } from 'hono'
import { requireAuth, requireConsultant } from '../middleware/auth'
import { YukassaClient } from '../lib/yukassa'
import { sendEmail, sendTelegram, bookingCreatedEmail, newBookingConsultantTelegram } from '../lib/notify'
import type { Bindings, Variables, MeetingFormat } from '../types'

const bookings = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// Форматирование даты для отображения (UTC → читаемый вид)
function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleString('ru-RU', {
      timeZone: 'Europe/Moscow',
      day: 'numeric', month: 'long', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    }) + ' МСК'
  } catch {
    return iso
  }
}

const meetingFormatLabels: Record<string, string> = {
  telemost: 'Видеозвонок TeleМост',
  telegram: 'Telegram/Макс',
  max: 'Макс',
  phone: 'Телефонный звонок'
}

// POST /api/bookings — создать бронирование + инициировать оплату
bookings.post('/', requireAuth, async (c) => {
  const userId = c.get('userId')
  const {
    consultant_id = 1,
    slot_id,
    tariff_id,
    meeting_format,
    client_question,
    client_contact
  } = await c.req.json()

  if (!tariff_id || !meeting_format) {
    return c.json({ error: 'tariff_id и meeting_format обязательны' }, 400)
  }

  // Проверяем тариф
  const tariff = await c.env.DB
    .prepare('SELECT * FROM tariffs WHERE id = ? AND is_active = 1')
    .bind(tariff_id)
    .first<{ id: number; name: string; price_rub: number; lk_only: number; is_support: number }>()

  if (!tariff) {
    return c.json({ error: 'Тариф не найден' }, 404)
  }

  // Тарифы сопровождения — только из ЛК по инициативе консультанта
  if (tariff.is_support && tariff.lk_only) {
    return c.json({ error: 'Этот тариф доступен только по приглашению консультанта' }, 403)
  }

  // Проверяем слот (если выбран)
  if (slot_id) {
    const slot = await c.env.DB
      .prepare('SELECT * FROM slots WHERE id = ? AND is_available = 1')
      .bind(slot_id)
      .first<{ id: number; starts_at: string; consultant_id: number }>()

    if (!slot) {
      return c.json({ error: 'Слот недоступен' }, 409)
    }

    const alreadyBooked = await c.env.DB
      .prepare("SELECT id FROM bookings WHERE slot_id = ? AND status IN ('paid', 'in_progress')")
      .bind(slot_id).first()

    if (alreadyBooked) {
      return c.json({ error: 'Слот уже занят' }, 409)
    }
  }

  // Создаём бронирование
  const result = await c.env.DB
    .prepare(`
      INSERT INTO bookings
        (user_id, consultant_id, slot_id, tariff_id, status,
         meeting_format, client_question, client_contact)
      VALUES (?, ?, ?, ?, 'pending_payment', ?, ?, ?)
    `)
    .bind(
      userId,
      consultant_id,
      slot_id || null,
      tariff_id,
      meeting_format,
      client_question || null,
      client_contact || null
    )
    .run()

  const bookingId = result.meta.last_row_id as number

  // Инициируем платёж в ЮKassa
  const baseUrl = c.env.BASE_URL || 'https://antinarkologia.ru'
  let paymentUrl = `${baseUrl}/lk?booking=${bookingId}&status=pending`
  let yukassaPaymentId: string | null = null

  try {
    const yukassa = new YukassaClient(
      c.env.YUKASSA_SHOP_ID,
      c.env.YUKASSA_SECRET_KEY
    )

    const slot = slot_id
      ? await c.env.DB.prepare('SELECT starts_at FROM slots WHERE id = ?').bind(slot_id).first<{ starts_at: string }>()
      : null

    const description = slot
      ? `${tariff.name} — ${formatDate(slot.starts_at)}`
      : tariff.name

    const yukPayment = await yukassa.createPayment(
      tariff.price_rub * 100, // ЮKassa ожидает копейки
      description,
      `${baseUrl}/lk?booking=${bookingId}&status=success`,
      { booking_id: String(bookingId) }
    )

    yukassaPaymentId = yukPayment.id
    paymentUrl = yukPayment.confirmation?.confirmation_url || paymentUrl

    // Сохраняем платёж
    await c.env.DB
      .prepare(`
        INSERT INTO payments
          (booking_id, yukassa_payment_id, yukassa_status, amount_rub, confirmation_url, raw_response)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .bind(
        bookingId,
        yukPayment.id,
        yukPayment.status,
        tariff.price_rub,
        paymentUrl,
        JSON.stringify(yukPayment)
      )
      .run()
  } catch (err) {
    // Если ЮKassa недоступна (dev-режим) — продолжаем без неё
    console.error('ЮKassa error:', err)
    await c.env.DB
      .prepare(`
        INSERT INTO payments (booking_id, amount_rub, yukassa_status)
        VALUES (?, ?, 'pending')
      `)
      .bind(bookingId, tariff.price_rub)
      .run()
  }

  // Уведомление клиенту по email
  const user = await c.env.DB
    .prepare('SELECT email, display_name FROM users WHERE id = ?')
    .bind(userId)
    .first<{ email: string | null; display_name: string | null }>()

  const slot = slot_id
    ? await c.env.DB.prepare('SELECT starts_at FROM slots WHERE id = ?').bind(slot_id).first<{ starts_at: string }>()
    : null

  if (user?.email) {
    const emailData = bookingCreatedEmail({
      displayName: user.display_name || '',
      tariffName: tariff.name,
      slotDate: slot ? formatDate(slot.starts_at) : 'По договорённости',
      meetingFormat: meetingFormatLabels[meeting_format] || meeting_format,
      paymentUrl
    })
    await sendEmail(c.env, { to: user.email, ...emailData })
  }

  return c.json({
    ok: true,
    bookingId,
    paymentUrl,
    yukassaPaymentId
  })
})

// GET /api/bookings/my — история бронирований текущего пользователя
bookings.get('/my', requireAuth, async (c) => {
  const userId = c.get('userId')

  const result = await c.env.DB
    .prepare(`
      SELECT
        b.*,
        t.name as tariff_name, t.price_rub,
        s.starts_at as slot_starts_at, s.ends_at as slot_ends_at,
        con.short_name as consultant_name, con.photo_url as consultant_photo,
        con.telegram_username as consultant_telegram,
        p.yukassa_status, p.confirmation_url, p.paid_at
      FROM bookings b
      LEFT JOIN tariffs t ON t.id = b.tariff_id
      LEFT JOIN slots s ON s.id = b.slot_id
      LEFT JOIN consultants con ON con.id = b.consultant_id
      LEFT JOIN payments p ON p.booking_id = b.id
      WHERE b.user_id = ?
      ORDER BY b.created_at DESC
      LIMIT 50
    `)
    .bind(userId)
    .all()

  return c.json({ bookings: result.results })
})

// GET /api/bookings/:id — одно бронирование (клиент видит своё, консультант — любое)
bookings.get('/:id', requireAuth, async (c) => {
  const userId = c.get('userId')
  const role = c.get('userRole')
  const id = c.req.param('id')

  const booking = await c.env.DB
    .prepare(`
      SELECT
        b.*,
        t.name as tariff_name, t.price_rub,
        s.starts_at as slot_starts_at,
        con.short_name as consultant_name, con.email as consultant_email,
        con.telegram_username as consultant_telegram,
        con.supports_telemost, con.supports_telegram, con.supports_phone,
        p.yukassa_status, p.confirmation_url, p.paid_at,
        u.display_name as client_name, u.email as client_email
      FROM bookings b
      LEFT JOIN tariffs t ON t.id = b.tariff_id
      LEFT JOIN slots s ON s.id = b.slot_id
      LEFT JOIN consultants con ON con.id = b.consultant_id
      LEFT JOIN payments p ON p.booking_id = b.id
      LEFT JOIN users u ON u.id = b.user_id
      WHERE b.id = ?
    `)
    .bind(id)
    .first()

  if (!booking) return c.json({ error: 'Не найдено' }, 404)

  // Клиент видит только своё
  if (role !== 'consultant' && (booking as any).user_id !== userId) {
    return c.json({ error: 'Доступ запрещён' }, 403)
  }

  return c.json({ booking })
})

// PATCH /api/bookings/:id — обновить детали встречи (консультант)
bookings.patch('/:id', requireConsultant, async (c) => {
  const id = c.req.param('id')
  const { meeting_link, consultant_notes, status } = await c.req.json()

  const updates: string[] = ["updated_at = datetime('now')"]
  const values: any[] = []

  if (meeting_link !== undefined) { updates.push('meeting_link = ?'); values.push(meeting_link) }
  if (consultant_notes !== undefined) { updates.push('consultant_notes = ?'); values.push(consultant_notes) }
  if (status) { updates.push('status = ?'); values.push(status) }

  values.push(id)

  await c.env.DB
    .prepare(`UPDATE bookings SET ${updates.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run()

  return c.json({ ok: true })
})

// POST /api/bookings/:id/cancel — отмена (клиент)
bookings.post('/:id/cancel', requireAuth, async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')

  const booking = await c.env.DB
    .prepare("SELECT * FROM bookings WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .first<{ id: number; status: string }>()

  if (!booking) return c.json({ error: 'Не найдено' }, 404)
  if (!['pending_payment', 'paid'].includes(booking.status)) {
    return c.json({ error: 'Нельзя отменить бронирование в текущем статусе' }, 409)
  }

  await c.env.DB
    .prepare(`
      UPDATE bookings
      SET status = 'cancelled', cancelled_at = datetime('now'), cancelled_by = 'user',
          updated_at = datetime('now')
      WHERE id = ?
    `)
    .bind(id).run()

  return c.json({ ok: true })
})

// ---- Панель консультанта ----

// GET /api/bookings/consultant/list — все бронирования для консультанта
bookings.get('/consultant/list', requireConsultant, async (c) => {
  const status = c.req.query('status') || ''
  const limit = parseInt(c.req.query('limit') || '50')

  let query = `
    SELECT
      b.*,
      t.name as tariff_name, t.price_rub,
      s.starts_at as slot_starts_at,
      p.yukassa_status, p.paid_at,
      u.display_name as client_name,
      u.email as client_email,
      u.telegram_username, u.vk_profile, u.max_profile
    FROM bookings b
    LEFT JOIN tariffs t ON t.id = b.tariff_id
    LEFT JOIN slots s ON s.id = b.slot_id
    LEFT JOIN payments p ON p.booking_id = b.id
    LEFT JOIN users u ON u.id = b.user_id
  `

  const params: any[] = []
  if (status) {
    query += ' WHERE b.status = ?'
    params.push(status)
  }
  query += ` ORDER BY b.created_at DESC LIMIT ${limit}`

  const result = await c.env.DB.prepare(query).bind(...params).all()

  return c.json({ bookings: result.results })
})

export default bookings
