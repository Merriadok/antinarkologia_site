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
// ВАЖНО — паттерн waitUntil:
//   Telegram ждёт ответ ≤ 10 сек. Вся обработка (DB + tgSend) идёт
//   через c.executionCtx.waitUntil() ПОСЛЕ return c.json({ok:true}).
//   Это устраняет таймаут 20 сек из PM2-логов.
//
// Прокси:
//   Российский хостер блокирует api.telegram.org напрямую.
//   Используем Cloudflare Worker-прокси:
//   https://tg-proxy-antinarkologia.trade-merry.workers.dev
// ============================================================

import { Hono } from 'hono'
import type { Bindings, Variables } from '../types'

const bot = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// ---- Telegram API helper (через прокси) ----
const TG_PROXY = 'https://tg-proxy-antinarkologia.trade-merry.workers.dev'

async function tgSend(
  token: string,
  chatId: number | string,
  text: string,
  options: Record<string, any> = {}
) {
  try {
    const resp = await fetch(`${TG_PROXY}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', ...options }),
    })
    if (!resp.ok) {
      console.error(`[tgSend] HTTP ${resp.status} chatId=${chatId}:`, await resp.text())
    }
    return resp
  } catch (err) {
    console.error(`[tgSend] fetch error chatId=${chatId}:`, err)
    throw err
  }
}

// ---- Основная обработка update (выполняется в фоне через waitUntil) ----
async function processUpdate(env: Bindings & { TELEGRAM_BOT_TOKEN: string }, update: any) {
  const token = env.TELEGRAM_BOT_TOKEN
  const msg = update.message || update.edited_message
  if (!msg) return

  const chatId = msg.chat.id
  const text   = (msg.text || '').trim()
  const from   = msg.from?.username || msg.from?.first_name || 'Пользователь'

  console.log(`[tgBot] update chatId=${chatId} text="${text.slice(0, 50)}"`)

  // ---- /start <code> — привязка аккаунта ----
  if (text.startsWith('/start')) {
    const parts = text.split(' ')
    const code  = parts[1] || ''

    if (code) {
      let userId: number | null = null
      try {
        // Buffer недоступен в Cloudflare Workers — используем atob (Web API)
        const decoded = atob(code)
        userId = parseInt(decoded) || parseInt(code)
        console.log(`[tgBot] /start code="${code}" decoded="${decoded}" userId=${userId}`)
      } catch {
        userId = parseInt(code)
        console.log(`[tgBot] /start atob failed, fallback parseInt userId=${userId}`)
      }

      if (userId && !isNaN(userId)) {
        const user = await (env.DB as D1Database)
          .prepare('SELECT id, display_name, login FROM users WHERE id = ?')
          .bind(userId)
          .first<{ id: number; display_name: string | null; login: string | null }>()

        if (user) {
          await (env.DB as D1Database)
            .prepare('UPDATE users SET telegram_bot_chat_id = ? WHERE id = ?')
            .bind(String(chatId), userId)
            .run()

          console.log(`[tgBot] Linked userId=${userId} to chatId=${chatId}`)

          await tgSend(token, chatId,
            `✅ Привет, <b>${user.display_name || user.login || 'пользователь'}</b>!\n\n` +
            `Ваш аккаунт <b>АНТИНаркология</b> привязан к этому Telegram.\n` +
            `Теперь вы будете получать уведомления здесь:\n` +
            `• Ответы консультанта в чате\n` +
            `• Напоминания о встрече\n` +
            `• Статус оплаты\n\n` +
            `Для перехода в личный кабинет:\n🔗 https://antinarkologia.ru/lk.html`
          )
          return
        }

        console.log(`[tgBot] User not found for userId=${userId}`)
      }

      await tgSend(token, chatId,
        '❌ Код не распознан. Перейдите в личный кабинет и нажмите «Подключить Telegram».\n' +
        '🔗 https://antinarkologia.ru/lk.html'
      )
      return
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
    return
  }

  // ---- /help ----
  if (text === '/help') {
    await tgSend(token, chatId,
      '📋 <b>Команды бота:</b>\n\n' +
      '/start — начало работы\n' +
      '/help  — эта справка\n' +
      '/me    — информация о привязанном аккаунте\n' +
      '/debug — диагностика (статус привязки)\n\n' +
      'Чат с консультантом доступен на сайте:\n' +
      '🔗 https://antinarkologia.ru/lk.html'
    )
    return
  }

  // ---- /me — информация об аккаунте ----
  if (text === '/me') {
    const user = await (env.DB as D1Database)
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
    return
  }

  // ---- /debug — диагностика ----
  if (text === '/debug') {
    const user = await (env.DB as D1Database)
      .prepare('SELECT id, display_name, login FROM users WHERE telegram_bot_chat_id = ?')
      .bind(String(chatId))
      .first<{ id: number; display_name: string | null; login: string | null }>()

    const booking = user
      ? await (env.DB as D1Database)
          .prepare(`SELECT id, status FROM bookings WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`)
          .bind(user.id)
          .first<{ id: number; status: string }>()
      : null

    const lines = [
      `🔍 <b>Debug info</b>`,
      ``,
      `Chat ID: <code>${chatId}</code>`,
      `Proxy: <code>${TG_PROXY}</code>`,
      ``,
      user
        ? `✅ Аккаунт: #${user.id} (${user.display_name || user.login || '—'})`
        : `❌ Аккаунт не привязан`,
      booking
        ? `📋 Последняя запись: #${booking.id} [${booking.status}]`
        : `📋 Записей нет`,
    ]

    await tgSend(token, chatId, lines.join('\n'))
    return
  }

  // ---- Обычный текст — попытка ответить в активный чат ----
  const user = await (env.DB as D1Database)
    .prepare('SELECT id FROM users WHERE telegram_bot_chat_id = ?')
    .bind(String(chatId))
    .first<{ id: number }>()

  if (!user) {
    await tgSend(token, chatId,
      '⚠️ Чтобы общаться через бота, сначала привяжите аккаунт.\n' +
      'Введите /start или перейдите на сайт:\n' +
      '🔗 https://antinarkologia.ru/lk.html'
    )
    return
  }

  // Находим последнюю запись (в т.ч. ожидающую оплаты)
  const booking = await (env.DB as D1Database)
    .prepare(`
      SELECT id FROM bookings
      WHERE user_id = ? AND status IN ('pending_payment', 'paid', 'in_progress')
      ORDER BY created_at DESC LIMIT 1
    `)
    .bind(user.id)
    .first<{ id: number }>()

  if (!booking) {
    await tgSend(token, chatId,
      'У вас нет активных записей для общения в чате.\n' +
      'Запишитесь на совет: 🔗 https://antinarkologia.ru/book.html'
    )
    return
  }

  // Сохраняем сообщение в чат
  await (env.DB as D1Database)
    .prepare('INSERT INTO chat_messages (booking_id, sender_type, sender_id, body) VALUES (?, ?, ?, ?)')
    .bind(booking.id, 'user', user.id, text)
    .run()

  console.log(`[tgBot] Saved msg to booking #${booking.id} from userId=${user.id}`)

  // Уведомляем консультанта
  const consultant = await (env.DB as D1Database)
    .prepare('SELECT telegram_chat_id FROM consultants WHERE is_active = 1 LIMIT 1')
    .first<{ telegram_chat_id: string | null }>()

  if (consultant?.telegram_chat_id) {
    await tgSend(token, consultant.telegram_chat_id,
      `💬 Новое сообщение (запись #${booking.id}):\n\n` +
      `От: ${from}\n"${text.length > 150 ? text.slice(0, 147) + '…' : text}"\n\n` +
      `👉 https://antinarkologia.ru/consultant.html`
    )
  }

  await tgSend(token, chatId,
    `✓ Сообщение отправлено консультанту (запись #${booking.id}).\n` +
    `Ответ придёт сюда или в личный кабинет:\n` +
    `🔗 https://antinarkologia.ru/lk.html`
  )
}

// ---- POST /api/telegram/webhook ----
bot.post('/webhook', async (c) => {
  // 1. Верификация секрета — быстро, до всего остального
  const secret = c.req.header('x-telegram-bot-api-secret-token')
  const expectedSecret = (c.env as any).TELEGRAM_BOT_SECRET
  if (expectedSecret && secret !== expectedSecret) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const token = (c.env as any).TELEGRAM_BOT_TOKEN
  if (!token) return c.json({ ok: true })

  let update: any
  try { update = await c.req.json() } catch { return c.json({ ok: true }) }

  const msg = update.message || update.edited_message
  if (!msg) return c.json({ ok: true })

  // 2. НЕМЕДЛЕННО отвечаем Telegram — до любых await DB/fetch
  //    Вся логика уходит в фон через waitUntil
  c.executionCtx.waitUntil(
    processUpdate({ ...c.env, TELEGRAM_BOT_TOKEN: token }, update)
      .catch(err => console.error('[tgBot] processUpdate error:', err))
  )

  // 3. Ответ Telegram получает < 1 мс — таймаут устранён
  return c.json({ ok: true })
})

export default bot
