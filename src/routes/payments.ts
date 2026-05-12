// ============================================================
// Роуты оплаты: webhook от ЮKassa, статус платежа
// ============================================================

import { Hono } from 'hono'
import { requireAuth } from '../middleware/auth'
import { YukassaClient } from '../lib/yukassa'
import { sendEmail, sendTelegram, bookingPaidEmail, newBookingConsultantTelegram } from '../lib/notify'
import { addSystemChatMessage } from './chat'
import type { Bindings, Variables } from '../types'

const payments = new Hono<{ Bindings: Bindings; Variables: Variables }>()

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
  telegram: 'Telegram / Макс',
  max: 'Макс',
  phone: 'Телефонный звонок'
}

// POST /api/payments/webhook — вебхук от ЮKassa
// ЮKassa шлёт POST при изменении статуса платежа
payments.post('/webhook', async (c) => {
  const rawBody = await c.req.text()

  // Верифицируем через перезапрос к ЮKassa
  const yukassa = new YukassaClient(c.env.YUKASSA_SHOP_ID, c.env.YUKASSA_SECRET_KEY)
  const yukPayment = await yukassa.verifyWebhook(rawBody)

  if (!yukPayment) {
    return c.json({ error: 'Невалидный вебхук' }, 400)
  }

  // Находим наш платёж
  const payment = await c.env.DB
    .prepare('SELECT * FROM payments WHERE yukassa_payment_id = ?')
    .bind(yukPayment.id)
    .first<{ id: number; booking_id: number; yukassa_status: string }>()

  if (!payment) {
    // Возможно, платёж ещё не создан в нашей БД — игнорируем
    return c.json({ ok: true })
  }

  // Обновляем статус платежа
  await c.env.DB
    .prepare(`
      UPDATE payments
      SET yukassa_status = ?, paid_at = ?, updated_at = datetime('now'),
          payment_method = ?, raw_response = ?
      WHERE id = ?
    `)
    .bind(
      yukPayment.status,
      yukPayment.status === 'succeeded' ? new Date().toISOString() : null,
      yukPayment.payment_method?.type || null,
      JSON.stringify(yukPayment),
      payment.id
    )
    .run()

  // Если платёж успешен — подтверждаем бронирование
  if (yukPayment.status === 'succeeded') {
    await c.env.DB
      .prepare(`
        UPDATE bookings
        SET status = 'paid', updated_at = datetime('now')
        WHERE id = ? AND status = 'pending_payment'
      `)
      .bind(payment.booking_id)
      .run()

    // Системное сообщение в чат — оплата прошла
    await addSystemChatMessage(
      c.env.DB, payment.booking_id,
      '✅ Оплата получена! Запись подтверждена.\n\nКонсультант скоро свяжется с вами. Вы можете написать ему прямо здесь.'
    )

    // Загружаем данные для уведомлений
    const booking = await c.env.DB
      .prepare(`
        SELECT b.*, t.name as tariff_name, s.starts_at as slot_starts_at,
               con.short_name as consultant_name, con.email as consultant_email,
               con.telegram_chat_id, con.telegram_username as consultant_tg,
               u.email as user_email, u.display_name, u.telegram_username as user_tg,
               u.max_profile as user_max
        FROM bookings b
        LEFT JOIN tariffs t ON t.id = b.tariff_id
        LEFT JOIN slots s ON s.id = b.slot_id
        LEFT JOIN consultants con ON con.id = b.consultant_id
        LEFT JOIN users u ON u.id = b.user_id
        WHERE b.id = ?
      `)
      .bind(payment.booking_id)
      .first<any>()

    if (booking) {
      const baseUrl = c.env.BASE_URL || 'https://antinarkologia.ru'
      const slotDate = booking.slot_starts_at ? formatDate(booking.slot_starts_at) : 'По договорённости'
      const meetFmt = meetingFormatLabels[booking.meeting_format] || booking.meeting_format

      // Определяем контакт консультанта для клиента
      let consultantContact = 'Консультант свяжется с вами'
      if (booking.meeting_format === 'telegram' && booking.consultant_tg) {
        consultantContact = `Telegram: @${booking.consultant_tg}`
      } else if (booking.consultant_email) {
        consultantContact = `Email: ${booking.consultant_email}`
      }

      // Email клиенту
      if (booking.user_email) {
        const emailData = bookingPaidEmail({
          displayName: booking.display_name || '',
          tariffName: booking.tariff_name,
          slotDate,
          meetingFormat: meetFmt,
          consultantContact,
          lkUrl: `${baseUrl}/lk`
        })
        await sendEmail(c.env, { to: booking.user_email, ...emailData })
      }

      // Telegram консультанту
      if (c.env.CONSULTANT_TELEGRAM_BOT_TOKEN && booking.telegram_chat_id) {
        // Определяем контакт клиента
        let clientContact = 'не указан'
        if (booking.meeting_format === 'telegram' && booking.user_tg) {
          clientContact = `@${booking.user_tg}`
        } else if (booking.meeting_format === 'max' && booking.user_max) {
          clientContact = booking.user_max
        } else if (booking.client_contact) {
          clientContact = booking.client_contact
        }

        const tgText = newBookingConsultantTelegram({
          bookingId: payment.booking_id,
          tariffName: booking.tariff_name,
          slotDate,
          meetingFormat: meetFmt,
          clientContact,
          clientQuestion: booking.client_question || '',
          panelUrl: `${baseUrl}/consultant`
        })

        await sendTelegram(c.env.CONSULTANT_TELEGRAM_BOT_TOKEN, booking.telegram_chat_id, tgText)
      }

      // Email консультанту
      if (booking.consultant_email) {
        await sendEmail(c.env, {
          to: booking.consultant_email,
          subject: `Новая оплаченная запись #${payment.booking_id}`,
          text: `Получена оплата за ${booking.tariff_name}.\nВремя: ${slotDate}\nФормат: ${meetFmt}\nВопрос клиента: ${booking.client_question || '—'}\n\nПанель: ${baseUrl}/consultant`
        })
      }

      // Лог уведомления
      await c.env.DB
        .prepare(`
          INSERT INTO notifications (user_id, consultant_id, booking_id, channel, type, subject, body, sent_at)
          VALUES (?, 1, ?, 'system', 'payment_success', 'Оплата подтверждена', ?, datetime('now'))
        `)
        .bind(booking.user_id, payment.booking_id, JSON.stringify({ bookingId: payment.booking_id }))
        .run()
    }
  }

  // Если платёж отменён
  if (yukPayment.status === 'canceled') {
    await c.env.DB
      .prepare("UPDATE bookings SET status = 'cancelled', updated_at = datetime('now') WHERE id = ? AND status = 'pending_payment'")
      .bind(payment.booking_id)
      .run()

    // Системное сообщение в чат — оплата не прошла
    await addSystemChatMessage(
      c.env.DB, payment.booking_id,
      '❌ Оплата не прошла или была отменена.\n\nЕсли вы хотите продолжить — создайте новую запись в личном кабинете.'
    )
  }

  return c.json({ ok: true })
})

// GET /api/payments/status/:bookingId — проверить статус оплаты (клиент)
payments.get('/status/:bookingId', requireAuth, async (c) => {
  const userId = c.get('userId')
  const bookingId = c.req.param('bookingId')

  const payment = await c.env.DB
    .prepare(`
      SELECT p.yukassa_status, p.paid_at, p.confirmation_url, b.status as booking_status
      FROM payments p
      JOIN bookings b ON b.id = p.booking_id
      WHERE p.booking_id = ? AND b.user_id = ?
    `)
    .bind(bookingId, userId)
    .first()

  if (!payment) return c.json({ error: 'Не найдено' }, 404)

  // Если статус всё ещё pending — перепроверяем у ЮKassa
  if ((payment as any).yukassa_status === 'pending' && c.env.YUKASSA_SHOP_ID) {
    try {
      const yukassa = new YukassaClient(c.env.YUKASSA_SHOP_ID, c.env.YUKASSA_SECRET_KEY)
      const pmt = await c.env.DB
        .prepare('SELECT yukassa_payment_id FROM payments WHERE booking_id = ?')
        .bind(bookingId)
        .first<{ yukassa_payment_id: string }>()

      if (pmt?.yukassa_payment_id) {
        const yukPayment = await yukassa.getPayment(pmt.yukassa_payment_id)
        // Обновляем без webhook
        if (yukPayment.status === 'succeeded') {
          await c.env.DB
            .prepare("UPDATE payments SET yukassa_status = 'succeeded', paid_at = datetime('now') WHERE booking_id = ?")
            .bind(bookingId).run()
          await c.env.DB
            .prepare("UPDATE bookings SET status = 'paid' WHERE id = ? AND status = 'pending_payment'")
            .bind(bookingId).run()
          return c.json({ status: 'paid' })
        }
      }
    } catch { /* ignore */ }
  }

  return c.json({
    status: (payment as any).booking_status,
    yukassaStatus: (payment as any).yukassa_status,
    paidAt: (payment as any).paid_at,
    confirmationUrl: (payment as any).confirmation_url
  })
})

export default payments
