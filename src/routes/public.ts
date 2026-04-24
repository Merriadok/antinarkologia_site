// ============================================================
// Публичные роуты: консультанты, тарифы, поддержка
// ============================================================

import { Hono } from 'hono'
import { requireAuth } from '../middleware/auth'
import { YukassaClient } from '../lib/yukassa'
import type { Bindings, Variables } from '../types'

const pub = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// GET /api/consultants — список активных консультантов
pub.get('/consultants', async (c) => {
  const result = await c.env.DB
    .prepare(`
      SELECT id, slug, short_name, full_name, title, bio_short, photo_url,
             supports_telemost, supports_telegram, supports_phone
      FROM consultants
      WHERE is_active = 1
      ORDER BY sort_order ASC
    `)
    .all()
  return c.json({ consultants: result.results })
})

// GET /api/tariffs — список тарифов (публичные: только не lk_only)
pub.get('/tariffs', async (c) => {
  const result = await c.env.DB
    .prepare(`
      SELECT id, slug, name, description, price_rub, duration_days, is_advice, is_support
      FROM tariffs
      WHERE is_active = 1
      ORDER BY sort_order ASC
    `)
    .all()
  return c.json({ tariffs: result.results })
})

// GET /api/user/profile — профиль текущего пользователя (ЛК)
pub.get('/user/profile', requireAuth, async (c) => {
  const userId = c.get('userId')
  const user = await c.env.DB
    .prepare(`
      SELECT id, email, login, display_name, phone, is_anonymous,
             telegram_username, vk_profile, max_profile, notify_email, created_at
      FROM users WHERE id = ?
    `)
    .bind(userId)
    .first()

  return c.json({ user })
})

// PATCH /api/user/profile — обновить профиль
pub.patch('/user/profile', requireAuth, async (c) => {
  const userId = c.get('userId')
  const { display_name, phone, telegram_username, vk_profile, max_profile, notify_email } = await c.req.json()

  const updates: string[] = ["last_seen_at = datetime('now')"]
  const values: any[] = []

  if (display_name !== undefined)     { updates.push('display_name = ?'); values.push(display_name) }
  if (phone !== undefined)            { updates.push('phone = ?'); values.push(phone) }
  if (telegram_username !== undefined){ updates.push('telegram_username = ?'); values.push(telegram_username) }
  if (vk_profile !== undefined)       { updates.push('vk_profile = ?'); values.push(vk_profile) }
  if (max_profile !== undefined)      { updates.push('max_profile = ?'); values.push(max_profile) }
  if (notify_email !== undefined)     { updates.push('notify_email = ?'); values.push(notify_email ? 1 : 0) }

  values.push(userId)

  await c.env.DB
    .prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run()

  return c.json({ ok: true })
})

// GET /api/user/support-contracts — контракты сопровождения клиента
pub.get('/user/support-contracts', requireAuth, async (c) => {
  const userId = c.get('userId')

  const result = await c.env.DB
    .prepare(`
      SELECT sc.*, t.name as tariff_name, t.price_rub as tariff_price
      FROM support_contracts sc
      JOIN tariffs t ON t.id = sc.tariff_id
      WHERE sc.user_id = ?
      ORDER BY sc.created_at DESC
    `)
    .bind(userId)
    .all()

  return c.json({ contracts: result.results })
})

// POST /api/user/support-contracts/:id/pay — оплатить сопровождение из ЛК
pub.post('/user/support-contracts/:id/pay', requireAuth, async (c) => {
  const userId = c.get('userId')
  const contractId = c.req.param('id')

  const contract = await c.env.DB
    .prepare(`
      SELECT sc.*, t.name as tariff_name, t.price_rub,
             COALESCE(sc.custom_price_rub, t.price_rub) as final_price
      FROM support_contracts sc
      JOIN tariffs t ON t.id = sc.tariff_id
      WHERE sc.id = ? AND sc.user_id = ? AND sc.status = 'awaiting_payment'
    `)
    .bind(contractId, userId)
    .first<any>()

  if (!contract) {
    return c.json({ error: 'Контракт не найден или уже оплачен' }, 404)
  }

  const baseUrl = c.env.BASE_URL || 'https://antinarkologia.ru'
  let paymentUrl = `${baseUrl}/lk?contract=${contractId}&status=pending`

  try {
    const yukassa = new YukassaClient(c.env.YUKASSA_SHOP_ID, c.env.YUKASSA_SECRET_KEY)
    const yukPayment = await yukassa.createPayment(
      contract.final_price * 100,
      contract.tariff_name,
      `${baseUrl}/lk?contract=${contractId}&status=success`,
      { contract_id: String(contractId), type: 'support' }
    )
    paymentUrl = yukPayment.confirmation?.confirmation_url || paymentUrl

    // Сохраняем платёж (без booking_id — используем отдельную запись)
    await c.env.DB
      .prepare(`
        INSERT INTO payments (booking_id, yukassa_payment_id, yukassa_status, amount_rub, confirmation_url)
        VALUES (0, ?, ?, ?, ?)
      `)
      .bind(yukPayment.id, yukPayment.status, contract.final_price, paymentUrl)
      .run()
  } catch (err) {
    console.error('ЮKassa support payment error:', err)
  }

  return c.json({ ok: true, paymentUrl })
})

export default pub
