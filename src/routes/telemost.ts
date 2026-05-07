// ============================================================
// Яндекс TeleМост — интеграция
// POST /api/telemost/create/:bookingId — создать/получить встречу
// GET  /api/telemost/status/:bookingId — статус встречи
// ============================================================
//
// ДОКУМЕНТАЦИЯ: https://yandex.ru/dev/telemost/doc/
// КЛЮЧИ: TELEMOST_API_KEY (OAuth-токен Яндекса сотрудника/орг.)
//        TELEMOST_ORG_ID  (ID организации в Яндекс 360, опц.)
//
// До получения ключей — заглушка возвращает тестовую ссылку.
// ============================================================

import { Hono } from 'hono'
import { requireAuth, requireConsultant } from '../middleware/auth'
import type { Bindings, Variables } from '../types'

const telemost = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// ---- Яндекс TeleМост API ----
const TELEMOST_API = 'https://cloud-api.yandex.net/v1/telemost-api/conferences'

interface TelemostConference {
  join_url:   string
  id:         string
  start_time?: string
}

async function createTelemostConference(apiKey: string): Promise<TelemostConference> {
  const resp = await fetch(TELEMOST_API, {
    method: 'POST',
    headers: {
      'Authorization': `OAuth ${apiKey}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      access_level: 'PRIVATE',   // только по ссылке
    }),
  })

  if (!resp.ok) {
    const err = await resp.text()
    throw new Error(`TeleМост API error ${resp.status}: ${err}`)
  }

  const data = await resp.json() as TelemostConference
  return data
}

// ---- POST /api/telemost/create/:bookingId ----
// Создаёт TeleМост-встречу и сохраняет ссылку в booking.meeting_link
// Если ключ не задан — возвращает инструкцию-заглушку
telemost.post('/create/:bookingId', requireConsultant, async (c) => {
  const bookingId = c.req.param('bookingId')

  // Проверяем что запись существует
  const booking = await c.env.DB
    .prepare('SELECT id, meeting_format, meeting_link FROM bookings WHERE id = ?')
    .bind(bookingId)
    .first<{ id: number; meeting_format: string; meeting_link: string | null }>()

  if (!booking) {
    return c.json({ error: 'Запись не найдена' }, 404)
  }

  // Если ссылка уже есть — возвращаем её (не создаём дубль)
  if (booking.meeting_link && booking.meeting_link.includes('telemost')) {
    return c.json({ ok: true, link: booking.meeting_link, existing: true })
  }

  // ---- Режим с реальным API ----
  const apiKey = (c.env as any).TELEMOST_API_KEY
  if (apiKey) {
    try {
      const conf = await createTelemostConference(apiKey)
      const link = conf.join_url

      // Сохраняем ссылку в бронировании
      await c.env.DB
        .prepare("UPDATE bookings SET meeting_link = ?, updated_at = datetime('now') WHERE id = ?")
        .bind(link, bookingId)
        .run()

      return c.json({ ok: true, link, conference_id: conf.id })
    } catch (err: any) {
      return c.json({ error: err.message, fallback: true }, 502)
    }
  }

  // ---- Режим-заглушка (ключ не задан) ----
  // Консультант должен создать встречу вручную на telemost.yandex.ru
  // и вставить ссылку через форму в панели
  return c.json({
    ok: false,
    placeholder: true,
    message: 'API-ключ TeleМост не настроен. Создайте встречу вручную на telemost.yandex.ru и вставьте ссылку в форму.',
    manual_url: 'https://telemost.yandex.ru',
  })
})

// ---- GET /api/telemost/status/:bookingId ----
// Возвращает ссылку на встречу для ЛК клиента (только если оплачено)
telemost.get('/status/:bookingId', requireAuth, async (c) => {
  const userId    = c.get('userId')
  const role      = c.get('userRole')
  const bookingId = c.req.param('bookingId')

  const booking = await c.env.DB
    .prepare(`
      SELECT id, user_id, status, meeting_format, meeting_link
      FROM bookings WHERE id = ?
    `)
    .bind(bookingId)
    .first<{
      id: number; user_id: number; status: string
      meeting_format: string; meeting_link: string | null
    }>()

  if (!booking) return c.json({ error: 'Не найдено' }, 404)

  // Клиент видит только свои записи
  if (role !== 'consultant' && booking.user_id !== userId) {
    return c.json({ error: 'Доступ запрещён' }, 403)
  }

  // Ссылку показываем только после оплаты
  const showLink = ['paid', 'in_progress', 'completed'].includes(booking.status)

  return c.json({
    ok: true,
    format: booking.meeting_format,
    link: showLink ? booking.meeting_link : null,
    status: booking.status,
    has_link: !!booking.meeting_link,
  })
})

export default telemost
