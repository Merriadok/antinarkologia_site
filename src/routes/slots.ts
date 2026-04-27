// ============================================================
// Роуты слотов: просмотр доступных, управление (консультант)
// ============================================================

import { Hono } from 'hono'
import { requireAuth, requireConsultant } from '../middleware/auth'
import type { Bindings, Variables } from '../types'

const slots = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// GET /api/slots?consultant_id=1&from=2025-05-01&to=2025-05-31[&all=1]
// Публичный: возвращает доступные слоты
// С параметром all=1 возвращает ВСЕ слоты (только для консультанта)
slots.get('/', async (c) => {
  const consultantId = c.req.query('consultant_id') || '1'
  const from = c.req.query('from') || new Date().toISOString().split('T')[0]
  const to   = c.req.query('to')   || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const showAll = c.req.query('all') === '1'

  const result = await c.env.DB
    .prepare(`
      SELECT s.id, s.starts_at, s.ends_at, s.is_available,
             CASE WHEN b.id IS NOT NULL THEN 1 ELSE 0 END as is_booked
      FROM slots s
      LEFT JOIN bookings b ON b.slot_id = s.id AND b.status IN ('paid', 'in_progress')
      WHERE s.consultant_id = ?
        AND s.starts_at >= ?
        AND s.starts_at <= ?
      ORDER BY s.starts_at ASC
    `)
    .bind(consultantId, from + 'T00:00:00Z', to + 'T23:59:59Z')
    .all()

  const slots = showAll
    ? result.results
    : result.results.filter((s: any) => s.is_available && !s.is_booked)

  return c.json({ slots })
})

// POST /api/slots — создать слот (только консультант)
slots.post('/', requireConsultant, async (c) => {
  const body = await c.req.json()
  const { starts_at, ends_at, consultant_id } = body

  if (!starts_at || !ends_at) {
    return c.json({ error: 'starts_at и ends_at обязательны' }, 400)
  }

  // Проверяем что не пересекается с существующими
  const overlap = await c.env.DB
    .prepare(`
      SELECT id FROM slots
      WHERE consultant_id = ?
        AND NOT (ends_at <= ? OR starts_at >= ?)
    `)
    .bind(consultant_id || 1, starts_at, ends_at)
    .first()

  if (overlap) {
    return c.json({ error: 'Слот пересекается с уже существующим' }, 409)
  }

  const result = await c.env.DB
    .prepare(`
      INSERT INTO slots (consultant_id, starts_at, ends_at, is_available)
      VALUES (?, ?, ?, 1)
    `)
    .bind(consultant_id || 1, starts_at, ends_at)
    .run()

  return c.json({ ok: true, slotId: result.meta.last_row_id })
})

// POST /api/slots/batch — создать много слотов сразу (консультант)
// Удобно для добавления расписания на неделю
slots.post('/batch', requireConsultant, async (c) => {
  const { consultant_id, slots: slotList } = await c.req.json()
  // slotList: Array<{ starts_at: string; ends_at: string }>

  if (!Array.isArray(slotList) || slotList.length === 0) {
    return c.json({ error: 'Список слотов пуст' }, 400)
  }
  if (slotList.length > 100) {
    return c.json({ error: 'Максимум 100 слотов за раз' }, 400)
  }

  const stmts = slotList.map((s: { starts_at: string; ends_at: string }) =>
    c.env.DB
      .prepare('INSERT OR IGNORE INTO slots (consultant_id, starts_at, ends_at, is_available) VALUES (?, ?, ?, 1)')
      .bind(consultant_id || 1, s.starts_at, s.ends_at)
  )

  await c.env.DB.batch(stmts)

  return c.json({ ok: true, created: slotList.length })
})

// DELETE /api/slots/:id — удалить слот (консультант)
slots.delete('/:id', requireConsultant, async (c) => {
  const id = c.req.param('id')

  // Нельзя удалить уже забронированный слот
  const booking = await c.env.DB
    .prepare("SELECT id FROM bookings WHERE slot_id = ? AND status IN ('paid', 'in_progress')")
    .bind(id).first()

  if (booking) {
    return c.json({ error: 'Слот уже забронирован и оплачен — нельзя удалить' }, 409)
  }

  await c.env.DB.prepare('DELETE FROM slots WHERE id = ?').bind(id).run()

  return c.json({ ok: true })
})

// PATCH /api/slots/:id/block — заблокировать слот без удаления (консультант)
slots.patch('/:id/block', requireConsultant, async (c) => {
  const id = c.req.param('id')
  await c.env.DB
    .prepare("UPDATE slots SET is_available = 0, updated_at = datetime('now') WHERE id = ?")
    .bind(id).run()
  return c.json({ ok: true })
})

export default slots
