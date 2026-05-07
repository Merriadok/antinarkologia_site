// ============================================================
// Внутренний чат: клиент ↔ консультант
// POST   /api/chat/:bookingId          — отправить сообщение
// GET    /api/chat/:bookingId          — получить историю
// POST   /api/chat/:bookingId/read     — пометить как прочитанные
// POST   /api/push/subscribe           — сохранить push-подписку
// DELETE /api/push/subscribe           — удалить push-подписку
// ============================================================

import { Hono } from 'hono'
import { requireAuth, requireConsultant } from '../middleware/auth'
import type { Bindings, Variables } from '../types'

const chat = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// ---- Вспомогательная: проверить доступ к чату ----
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

  // Получаем данные о записи
  const booking = await (env.DB as D1Database)
    .prepare(`
      SELECT b.id, u.display_name, u.telegram_username,
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
      consultant_tg_id: string | null
    }>()

  if (!booking) return

  const preview = body.length > 100 ? body.slice(0, 97) + '…' : body

  if (senderType === 'user' && booking.consultant_tg_id) {
    // Уведомить консультанта о новом сообщении от клиента
    const clientName = booking.display_name || `Клиент #${bookingId}`
    await sendTelegramNotification(
      env.TELEGRAM_BOT_TOKEN,
      booking.consultant_tg_id,
      `💬 Новое сообщение в чате (запись #${bookingId})\n` +
      `От: ${clientName}\n\n"${preview}"\n\n` +
      `👉 Ответить: ${env.BASE_URL || 'https://antinarkologia.ru'}/consultant.html`
    )
  } else if (senderType === 'consultant' && booking.telegram_username) {
    // Уведомить клиента о ответе консультанта через бот
    // (только если клиент подписан на бота)
    const chatId = await findUserTelegramChatId(env.DB as D1Database, bookingId)
    if (chatId) {
      await sendTelegramNotification(
        env.TELEGRAM_BOT_TOKEN,
        chatId,
        `💬 Консультант ответил в чате (запись #${bookingId})\n\n"${preview}"\n\n` +
        `👉 Открыть чат: ${env.BASE_URL || 'https://antinarkologia.ru'}/lk.html`
      )
    }
  }
}

async function findUserTelegramChatId(db: D1Database, bookingId: string): Promise<string | null> {
  // telegram_bot_chat_id — опциональное поле, добавляется через миграцию 0005
  // Возвращает null если поле ещё не добавлено или не заполнено
  try {
    const row = await db
      .prepare(`
        SELECT u.telegram_bot_chat_id
        FROM bookings b
        JOIN users u ON u.id = b.user_id
        WHERE b.id = ?
      `)
      .bind(bookingId)
      .first<{ telegram_bot_chat_id: string | null }>()
    return row?.telegram_bot_chat_id || null
  } catch {
    return null  // колонка ещё не добавлена
  }
}

async function sendTelegramNotification(
  botToken: string,
  chatId: string,
  text: string
) {
  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML'
    })
  })
}

export default chat
