// ============================================================
// Telegram Bot Webhook
// POST /api/telegram/webhook  — входящие сообщения от Telegram
//
// Функционал:
//   1. /start — регистрирует telegram_bot_chat_id для пользователя
//      по коду подтверждения (клиент вводит в боте свой user_id или код)
//   2. Текстовые сообщения — перенаправляет в активный чат записи
//   3. Уведомление об ответе консультанта клиенту
//
// Нужно от пользователя:
//   TELEGRAM_BOT_TOKEN — ключ от @BotFather
//   TELEGRAM_BOT_SECRET — секрет для верификации webhook (x-telegram-bot-api-secret-token)
//
// Установка webhook (один раз):
//   curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
//     -H "Content-Type: application/json" \
//     -d '{"url":"https://antinarkologia.ru/api/telegram/webhook","secret_token":"<SECRET>"}'
// ============================================================

import { Hono } from 'hono'
import type { Bindings, Variables } from '../types'

const bot = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// ---- Telegram API helper ----
async function tgSend(token: string, chatId: number | string, text: string, options: Record<string, any> = {}) {
  return fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', ...options }),
  })
}

// ---- POST /api/telegram/webhook ----
bot.post('/webhook', async (c) => {
  // Верификация секрета
  const secret = c.req.header('x-telegram-bot-api-secret-token')
  const expectedSecret = (c.env as any).TELEGRAM_BOT_SECRET
  if (expectedSecret && secret !== expectedSecret) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const token = (c.env as any).TELEGRAM_BOT_TOKEN
  if (!token) return c.json({ ok: true })  // бот не настроен

  let update: any
  try { update = await c.req.json() } catch { return c.json({ ok: true }) }

  const msg = update.message || update.edited_message
  if (!msg) return c.json({ ok: true })

  const chatId = msg.chat.id
  const text   = (msg.text || '').trim()
  const from   = msg.from?.username || msg.from?.first_name || 'Пользователь'

  // ---- /start <code> — привязка аккаунта ----
  if (text.startsWith('/start')) {
    const parts = text.split(' ')
    const code  = parts[1] || ''

    if (code) {
      // Ищем пользователя по коду (user_id закодирован в base64 или просто число)
      let userId: number | null = null
      try { userId = parseInt(Buffer.from(code, 'base64').toString()) || parseInt(code) } catch { userId = parseInt(code) }

      if (userId && !isNaN(userId)) {
        const user = await c.env.DB
          .prepare('SELECT id, display_name, login FROM users WHERE id = ?')
          .bind(userId)
          .first<{ id: number; display_name: string | null; login: string | null }>()

        if (user) {
          await c.env.DB
            .prepare("UPDATE users SET telegram_bot_chat_id = ? WHERE id = ?")
            .bind(String(chatId), userId)
            .run()

          await tgSend(token, chatId,
            `✅ Привет, <b>${user.display_name || user.login || 'пользователь'}</b>!\n\n` +
            `Ваш аккаунт <b>АНТИНаркология</b> привязан к этому Telegram.\n` +
            `Теперь вы будете получать уведомления здесь:\n` +
            `• Ответы консультанта в чате\n` +
            `• Напоминания о встрече\n` +
            `• Статус оплаты\n\n` +
            `Для перехода в личный кабинет:\n🔗 https://antinarkologia.ru/lk.html`
          )
          return c.json({ ok: true })
        }
      }

      await tgSend(token, chatId,
        '❌ Код не распознан. Перейдите в личный кабинет и нажмите «Подключить Telegram».\n' +
        '🔗 https://antinarkologia.ru/lk.html'
      )
      return c.json({ ok: true })
    }

    // /start без кода
    await tgSend(token, chatId,
      '👋 Здравствуйте!\n\n' +
      'Это бот <b>АНТИНаркологии</b> — анонимного совета по вопросам зависимостей.\n\n' +
      'Для привязки аккаунта:\n' +
      '1. Войдите в личный кабинет\n' +
      '2. Раздел «Профиль» → «Подключить Telegram»\n' +
      '3. Нажмите кнопку — получите ссылку\n\n' +
      '🔗 https://antinarkologia.ru/lk.html',
      { reply_markup: { inline_keyboard: [[{ text: '📖 Открыть кабинет', url: 'https://antinarkologia.ru/lk.html' }]] } }
    )
    return c.json({ ok: true })
  }

  // ---- /help ----
  if (text === '/help') {
    await tgSend(token, chatId,
      '📋 <b>Команды бота:</b>\n\n' +
      '/start — начало работы\n' +
      '/help  — эта справка\n' +
      '/me    — информация о привязанном аккаунте\n\n' +
      'Чат с консультантом доступен на сайте:\n' +
      '🔗 https://antinarkologia.ru/lk.html'
    )
    return c.json({ ok: true })
  }

  // ---- /me — информация об аккаунте ----
  if (text === '/me') {
    const user = await c.env.DB
      .prepare('SELECT id, display_name, login, email FROM users WHERE telegram_bot_chat_id = ?')
      .bind(String(chatId))
      .first<{ id: number; display_name: string | null; login: string | null; email: string | null }>()

    if (user) {
      await tgSend(token, chatId,
        `👤 <b>Ваш аккаунт:</b>\n\n` +
        `ID: ${user.id}\n` +
        `Имя: ${user.display_name || user.login || '—'}\n` +
        `Email: ${user.email || 'не указан'}\n\n` +
        `Аккаунт привязан ✅`
      )
    } else {
      await tgSend(token, chatId, '❌ Аккаунт не привязан. Введите /start для начала.')
    }
    return c.json({ ok: true })
  }

  // ---- Обычный текст — попытка ответить в активный чат ----
  // Ищем последнюю оплаченную запись пользователя
  const user = await c.env.DB
    .prepare('SELECT id FROM users WHERE telegram_bot_chat_id = ?')
    .bind(String(chatId))
    .first<{ id: number }>()

  if (!user) {
    await tgSend(token, chatId,
      '⚠️ Чтобы общаться через бота, сначала привяжите аккаунт.\n' +
      'Введите /start или перейдите на сайт:\n' +
      '🔗 https://antinarkologia.ru/lk.html'
    )
    return c.json({ ok: true })
  }

  // Находим последнюю активную запись
  const booking = await c.env.DB
    .prepare(`
      SELECT id FROM bookings
      WHERE user_id = ? AND status IN ('paid', 'in_progress')
      ORDER BY created_at DESC LIMIT 1
    `)
    .bind(user.id)
    .first<{ id: number }>()

  if (!booking) {
    await tgSend(token, chatId,
      'У вас нет активных записей для общения в чате.\n' +
      'Запишитесь на совет: 🔗 https://antinarkologia.ru/book.html'
    )
    return c.json({ ok: true })
  }

  // Сохраняем сообщение в чат
  await c.env.DB
    .prepare('INSERT INTO chat_messages (booking_id, sender_type, sender_id, body) VALUES (?, ?, ?, ?)')
    .bind(booking.id, 'user', user.id, text)
    .run()

  // Уведомляем консультанта
  const consultant = await c.env.DB
    .prepare('SELECT telegram_chat_id FROM consultants WHERE is_active = 1 LIMIT 1')
    .first<{ telegram_chat_id: string | null }>()

  if (consultant?.telegram_chat_id) {
    await tgSend(token, consultant.telegram_chat_id,
      `💬 Новое сообщение (запись #${booking.id}):\n\n` +
      `От: ${from}\n"${text.length > 150 ? text.slice(0,147) + '…' : text}"\n\n` +
      `👉 https://antinarkologia.ru/consultant.html`
    )
  }

  await tgSend(token, chatId,
    `✓ Сообщение отправлено консультанту (запись #${booking.id}).\n` +
    `Ответ придёт сюда или в личный кабинет:\n` +
    `🔗 https://antinarkologia.ru/lk.html`
  )

  return c.json({ ok: true })
})

export default bot
