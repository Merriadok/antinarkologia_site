// ============================================================
// Внутренний чат: клиент ↔ консультант
// POST   /api/chat/:bookingId          — отправить сообщение
// GET    /api/chat/:bookingId          — получить историю
// POST   /api/chat/:bookingId/read     — пометить как прочитанные
// POST   /api/chat/:bookingId/system   — системное сообщение (внутренний вызов)
//
// Доступ к чату:
//   Чат открыт сразу после создания записи (status = pending_payment тоже OK).
//   Фильтр по status='paid' убран — клиент может писать с момента создания записи.
// ============================================================

import { Hono } from 'hono'
import { requireAuth, requireConsultant } from '../middleware/auth'
import type { Bindings, Variables } from '../types'

const chat = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// ---- Вспомогательная: проверить доступ к чату ----
// Просмотр разрешён для ВСЕХ статусов (включая cancelled/completed)
async function canAccessChat(
  db: D1Database,
  bookingId: string,
  userId: number,
  role: string
): Promise<boolean> {
  const booking = await db
    .prepare('SELECT user_id FROM bookings WHERE id = ?')
    .bind(bookingId)
    .first<{ user_id: number }>()
  if (!booking) return false
  if (role === 'consultant') return true
  return booking.user_id === userId
}

// ---- Вспомогательная: проверить можно ли ПИСАТЬ в чат ----
// Закрытые статусы: запись завершена или отменена — клиент не может писать
const CLOSED_STATUSES = ['cancelled', 'completed', 'refunded'] as const

async function canSendMessage(
  db: D1Database,
  bookingId: string,
  role: string
): Promise<{ allowed: boolean; reason?: string }> {
  if (role === 'consultant') return { allowed: true } // консультант всегда может писать
  const booking = await db
    .prepare('SELECT status FROM bookings WHERE id = ?')
    .bind(bookingId)
    .first<{ status: string }>()
  if (!booking) return { allowed: false, reason: 'Запись не найдена' }
  if ((CLOSED_STATUSES as readonly string[]).includes(booking.status)) {
    return { allowed: false, reason: 'Чат закрыт — запись завершена или отменена' }
  }
  return { allowed: true }
}

// addSystemChatMessage вынесена в src/lib/chat_utils.ts (избегаем circular import)

// ---- GET /api/chat/:bookingId — история сообщений ----
chat.get('/:bookingId', requireAuth, async (c) => {
  const userId    = c.get('userId')
  const role      = c.get('userRole')
  const bookingId = c.req.param('bookingId')

  if (!(await canAccessChat(c.env.DB, bookingId, userId, role))) {
    return c.json({ error: 'Доступ запрещён' }, 403)
  }

  const result = await c.env.DB
    .prepare(`
      SELECT id, sender_type, sender_id, body, is_read, created_at
      FROM chat_messages
      WHERE booking_id = ?
      ORDER BY created_at ASC
      LIMIT 200
    `)
    .bind(bookingId)
    .all()

  // Считаем непрочитанные для текущего участника
  // system-сообщения не считаются непрочитанными (только user/consultant)
  const unreadType = role === 'consultant' ? 'user' : 'consultant'
  const unread = (result.results as any[]).filter(
    m => m.sender_type === unreadType && !m.is_read
  ).length

  return c.json({ messages: result.results, unread })
})

// ---- POST /api/chat/:bookingId — отправить сообщение ----
chat.post('/:bookingId', requireAuth, async (c) => {
  const userId    = c.get('userId')
  const role      = c.get('userRole')
  const bookingId = c.req.param('bookingId')

  if (!(await canAccessChat(c.env.DB, bookingId, userId, role))) {
    return c.json({ error: 'Доступ запрещён' }, 403)
  }

  // Проверяем можно ли писать (закрытые записи — только просмотр)
  const sendCheck = await canSendMessage(c.env.DB, bookingId, role)
  if (!sendCheck.allowed) {
    return c.json({ error: sendCheck.reason || 'Отправка сообщений недоступна' }, 403)
  }

  const { body } = await c.req.json()
  if (!body || !body.trim()) {
    return c.json({ error: 'Сообщение не может быть пустым' }, 400)
  }

  const senderType = role === 'consultant' ? 'consultant' : 'user'
  const senderId   = role === 'consultant'
    ? (await c.env.DB.prepare('SELECT id FROM consultants WHERE is_active = 1 LIMIT 1').first<{ id: number }>())?.id || 1
    : userId

  const result = await c.env.DB
    .prepare(`
      INSERT INTO chat_messages (booking_id, sender_type, sender_id, body)
      VALUES (?, ?, ?, ?)
    `)
    .bind(bookingId, senderType, senderId, body.trim())
    .run()

  // Уведомление через Telegram-бот (если настроен)
  try {
    await notifyNewMessage(c.env, bookingId, senderType, body.trim())
  } catch (_) { /* не блокируем если бот не настроен */ }

  return c.json({ ok: true, id: result.meta.last_row_id })
})

// ---- POST /api/chat/:bookingId/read — пометить прочитанными ----
chat.post('/:bookingId/read', requireAuth, async (c) => {
  const userId    = c.get('userId')
  const role      = c.get('userRole')
  const bookingId = c.req.param('bookingId')

  if (!(await canAccessChat(c.env.DB, bookingId, userId, role))) {
    return c.json({ error: 'Доступ запрещён' }, 403)
  }

  // Помечаем прочитанными сообщения от противоположной стороны
  const senderType = role === 'consultant' ? 'user' : 'consultant'

  await c.env.DB
    .prepare(`
      UPDATE chat_messages
      SET is_read = 1
      WHERE booking_id = ? AND sender_type = ? AND is_read = 0
    `)
    .bind(bookingId, senderType)
    .run()

  return c.json({ ok: true })
})

// ---- Telegram-уведомление о новом сообщении ----
async function notifyNewMessage(
  env: Bindings,
  bookingId: string,
  senderType: string,
  body: string
) {
  if (!env.TELEGRAM_BOT_TOKEN) return

  const booking = await (env.DB as D1Database)
    .prepare(`
      SELECT b.id, u.display_name, u.telegram_username,
             u.telegram_bot_chat_id as user_tg_chat_id,
             con.telegram_chat_id as consultant_tg_id
      FROM bookings b
      LEFT JOIN users u ON u.id = b.user_id
      LEFT JOIN consultants con ON con.id = b.consultant_id
      WHERE b.id = ?
    `)
    .bind(bookingId)
    .first<{
      id: number
      display_name: string | null
      telegram_username: string | null
      user_tg_chat_id: string | null
      consultant_tg_id: string | null
    }>()

  if (!booking) return

  const preview = body.length > 100 ? body.slice(0, 97) + '…' : body
  const baseUrl = (env as any).BASE_URL || 'https://antinarkologia.ru'
  const proxyBase = 'https://tg-proxy-antinarkologia.trade-merry.workers.dev'

  if (senderType === 'user' && booking.consultant_tg_id) {
    const clientName = booking.display_name || `Клиент #${bookingId}`
    await fetch(`${proxyBase}/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: booking.consultant_tg_id,
        text: `💬 Новое сообщение в чате (запись #${bookingId})\nОт: ${clientName}\n\n"${preview}"\n\n👉 Ответить: ${baseUrl}/consultant.html`,
        parse_mode: 'HTML'
      })
    })
  } else if (senderType === 'consultant' && booking.user_tg_chat_id) {
    await fetch(`${proxyBase}/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: booking.user_tg_chat_id,
        text: `💬 Консультант ответил в чате (запись #${bookingId})\n\n"${preview}"\n\n👉 Открыть чат: ${baseUrl}/lk.html`,
        parse_mode: 'HTML'
      })
    })
  }
}

export default chat
