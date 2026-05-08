// ============================================================
// Роуты авторизации: регистрация, вход, выход
// Поддерживает 3 режима: email+пароль, анонимный, OAuth (заглушки)
// ============================================================

import { Hono } from 'hono'
import { setCookie, deleteCookie } from 'hono/cookie'
import { hashPassword, verifyPassword, signJWT } from '../lib/auth'
import type { Bindings, Variables } from '../types'

const auth = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// Кука secure только когда реально HTTPS
// (при доступе по IP или HTTP — не ставим secure, иначе браузер её не отправляет)
function isSecureRequest(c: any): boolean {
  const proto = c.req.header('X-Forwarded-Proto') || c.req.header('x-forwarded-proto')
  if (proto === 'https') return true
  // Прямой URL
  const url = c.req.url
  return url.startsWith('https://')
}

function cookieOpts(c: any, maxAge: number) {
  return {
    httpOnly: true,
    secure: isSecureRequest(c),
    sameSite: 'Lax' as const,
    path: '/',
    maxAge
  }
}

// POST /api/auth/register/email — регистрация через email + пароль
auth.post('/register/email', async (c) => {
  const { email, password, display_name } = await c.req.json()

  if (!email || !password) {
    return c.json({ error: 'Email и пароль обязательны' }, 400)
  }
  if (password.length < 6) {
    return c.json({ error: 'Пароль должен быть не менее 6 символов' }, 400)
  }

  const existing = await c.env.DB
    .prepare('SELECT id FROM users WHERE email = ?')
    .bind(email.toLowerCase()).first()

  if (existing) {
    return c.json({ error: 'Этот email уже зарегистрирован' }, 409)
  }

  const passwordHash = await hashPassword(password)

  const result = await c.env.DB
    .prepare(`
      INSERT INTO users (email, password_hash, display_name, is_anonymous)
      VALUES (?, ?, ?, 0)
    `)
    .bind(email.toLowerCase(), passwordHash, display_name || null)
    .run()

  const userId = result.meta.last_row_id as number
  const token = await signJWT({ userId, role: 'client' }, c.env.JWT_SECRET || 'dev-secret-change-in-prod')

  setCookie(c, 'auth_token', token, cookieOpts(c, 60 * 60 * 24 * 30))

  return c.json({ ok: true, userId, token })
})

// POST /api/auth/register/anonymous — анонимный вход (логин + пароль, без email)
auth.post('/register/anonymous', async (c) => {
  const { login, password } = await c.req.json()

  if (!login || !password) {
    return c.json({ error: 'Логин и пароль обязательны' }, 400)
  }
  if (login.length < 3) {
    return c.json({ error: 'Логин должен быть не менее 3 символов' }, 400)
  }
  if (password.length < 6) {
    return c.json({ error: 'Пароль должен быть не менее 6 символов' }, 400)
  }

  const existing = await c.env.DB
    .prepare('SELECT id FROM users WHERE login = ?')
    .bind(login).first()

  if (existing) {
    return c.json({ error: 'Этот логин уже занят' }, 409)
  }

  const passwordHash = await hashPassword(password)

  const result = await c.env.DB
    .prepare(`
      INSERT INTO users (login, password_hash, is_anonymous, notify_email)
      VALUES (?, ?, 1, 0)
    `)
    .bind(login, passwordHash)
    .run()

  const userId = result.meta.last_row_id as number
  const token = await signJWT({ userId, role: 'client' }, c.env.JWT_SECRET || 'dev-secret-change-in-prod')

  setCookie(c, 'auth_token', token, cookieOpts(c, 60 * 60 * 24 * 30))

  return c.json({ ok: true, userId, token, login })
})

// POST /api/auth/login — вход по email или логину + пароль
auth.post('/login', async (c) => {
  const { email, login, password } = await c.req.json()

  if (!password || (!email && !login)) {
    return c.json({ error: 'Укажите email или логин и пароль' }, 400)
  }

  let user: { id: number; password_hash: string } | null = null

  if (email) {
    user = await c.env.DB
      .prepare('SELECT id, password_hash FROM users WHERE email = ?')
      .bind(email.toLowerCase())
      .first<{ id: number; password_hash: string }>()
  } else if (login) {
    user = await c.env.DB
      .prepare('SELECT id, password_hash FROM users WHERE login = ?')
      .bind(login)
      .first<{ id: number; password_hash: string }>()
  }

  if (!user || !user.password_hash) {
    return c.json({ error: 'Неверный логин или пароль' }, 401)
  }

  const ok = await verifyPassword(password, user.password_hash)
  if (!ok) {
    return c.json({ error: 'Неверный логин или пароль' }, 401)
  }

  // Обновляем last_seen_at
  await c.env.DB
    .prepare("UPDATE users SET last_seen_at = datetime('now') WHERE id = ?")
    .bind(user.id).run()

  const token = await signJWT({ userId: user.id, role: 'client' }, c.env.JWT_SECRET || 'dev-secret-change-in-prod')

  setCookie(c, 'auth_token', token, cookieOpts(c, 60 * 60 * 24 * 30))

  return c.json({ ok: true, userId: user.id, token })
})

// POST /api/auth/login/consultant — вход для консультанта
auth.post('/login/consultant', async (c) => {
  const { email, password } = await c.req.json()

  if (!email || !password) {
    return c.json({ error: 'Email и пароль обязательны' }, 400)
  }

  // Консультант хранится в таблице consultants, у него есть email
  // Пароль — в отдельной "системной" записи users с role=consultant
  const user = await c.env.DB
    .prepare("SELECT id, password_hash FROM users WHERE email = ? AND auth_provider = 'consultant'")
    .bind(email.toLowerCase())
    .first<{ id: number; password_hash: string }>()

  if (!user || !user.password_hash) {
    return c.json({ error: 'Неверный email или пароль' }, 401)
  }

  const ok = await verifyPassword(password, user.password_hash)
  if (!ok) {
    return c.json({ error: 'Неверный email или пароль' }, 401)
  }

  const token = await signJWT({ userId: user.id, role: 'consultant' }, c.env.JWT_SECRET || 'dev-secret-change-in-prod')

  setCookie(c, 'auth_token', token, cookieOpts(c, 60 * 60 * 24 * 7))

  return c.json({ ok: true, userId: user.id, token })
})

// POST /api/auth/logout
auth.post('/logout', async (c) => {
  deleteCookie(c, 'auth_token')
  return c.json({ ok: true })
})

// GET /api/auth/me — текущий пользователь
auth.get('/me', async (c) => {
  const { getCookie } = await import('hono/cookie')
  const { verifyJWT } = await import('../lib/auth')

  const token = getCookie(c, 'auth_token') || c.req.header('Authorization')?.replace('Bearer ', '')
  if (!token) return c.json({ user: null })

  const payload = await verifyJWT(token, c.env.JWT_SECRET || 'dev-secret-change-in-prod')
  if (!payload) return c.json({ user: null })

  const user = await c.env.DB
    .prepare('SELECT id, email, login, display_name, is_anonymous, telegram_username, notify_email FROM users WHERE id = ?')
    .bind(payload.userId)
    .first()

  return c.json({ user, role: payload.role })
})

export default auth
