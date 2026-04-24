// ============================================================
// Middleware авторизации
// ============================================================

import { createMiddleware } from 'hono/factory'
import { getCookie } from 'hono/cookie'
import { verifyJWT } from '../lib/auth'
import type { Bindings, Variables } from '../types'

// Обязательная авторизация — возвращает 401 если не авторизован
export const requireAuth = createMiddleware<{ Bindings: Bindings; Variables: Variables }>(
  async (c, next) => {
    const token = getCookie(c, 'auth_token') || c.req.header('Authorization')?.replace('Bearer ', '')

    if (!token) {
      return c.json({ error: 'Не авторизован' }, 401)
    }

    const payload = await verifyJWT(token, c.env.JWT_SECRET || 'dev-secret-change-in-prod')
    if (!payload) {
      return c.json({ error: 'Токен недействителен или истёк' }, 401)
    }

    c.set('userId', payload.userId)
    c.set('userRole', payload.role as 'client' | 'consultant')

    await next()
  }
)

// Только для консультанта (панель управления)
export const requireConsultant = createMiddleware<{ Bindings: Bindings; Variables: Variables }>(
  async (c, next) => {
    const token = getCookie(c, 'auth_token') || c.req.header('Authorization')?.replace('Bearer ', '')

    if (!token) {
      return c.json({ error: 'Не авторизован' }, 401)
    }

    const payload = await verifyJWT(token, c.env.JWT_SECRET || 'dev-secret-change-in-prod')
    if (!payload) {
      return c.json({ error: 'Токен недействителен или истёк' }, 401)
    }

    if (payload.role !== 'consultant') {
      return c.json({ error: 'Доступ запрещён' }, 403)
    }

    c.set('userId', payload.userId)
    c.set('userRole', 'consultant')

    await next()
  }
)

// Опциональная авторизация — не возвращает ошибку, просто не ставит userId
export const optionalAuth = createMiddleware<{ Bindings: Bindings; Variables: Variables }>(
  async (c, next) => {
    const token = getCookie(c, 'auth_token') || c.req.header('Authorization')?.replace('Bearer ', '')

    if (token) {
      const payload = await verifyJWT(token, c.env.JWT_SECRET || 'dev-secret-change-in-prod')
      if (payload) {
        c.set('userId', payload.userId)
        c.set('userRole', payload.role as 'client' | 'consultant')
      }
    }

    await next()
  }
)
