// ============================================================
// Web Push — подписки на браузерные уведомления
// POST   /api/push/subscribe    — сохранить подписку
// DELETE /api/push/subscribe    — удалить подписку
// GET    /api/push/vapid-key    — получить VAPID public key
// ============================================================

import { Hono } from 'hono'
import { requireAuth } from '../middleware/auth'
import type { Bindings, Variables } from '../types'

const push = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// GET /api/push/vapid-key — публичный VAPID-ключ для SW
push.get('/vapid-key', (c) => {
  const key = (c.env as any).VAPID_PUBLIC_KEY || ''
  return c.json({ key, enabled: !!key })
})

// POST /api/push/subscribe — регистрация push-подписки
push.post('/subscribe', requireAuth, async (c) => {
  const userId = c.get('userId')
  const { endpoint, p256dh, auth, userAgent } = await c.req.json()

  if (!endpoint || !p256dh || !auth) {
    return c.json({ error: 'endpoint, p256dh и auth обязательны' }, 400)
  }

  await c.env.DB
    .prepare(`
      INSERT INTO push_subscriptions (user_id, endpoint, p256dh_key, auth_key, user_agent)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (user_id, endpoint)
      DO UPDATE SET p256dh_key = excluded.p256dh_key,
                    auth_key   = excluded.auth_key,
                    last_used_at = datetime('now')
    `)
    .bind(userId, endpoint, p256dh, auth, userAgent || null)
    .run()

  return c.json({ ok: true })
})

// DELETE /api/push/subscribe — удалить подписку
push.delete('/subscribe', requireAuth, async (c) => {
  const userId = c.get('userId')
  const { endpoint } = await c.req.json()

  await c.env.DB
    .prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?')
    .bind(userId, endpoint)
    .run()

  return c.json({ ok: true })
})

export default push
