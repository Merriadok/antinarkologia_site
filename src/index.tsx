// ============================================================
// АНТИНаркология — главный файл приложения
// ============================================================

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { serveStatic } from 'hono/cloudflare-workers'

import authRoutes       from './routes/auth'
import pagesRoutes      from './routes/pages'
import slotsRoutes      from './routes/slots'
import bookingsRoutes   from './routes/bookings'
import paymentsRoutes   from './routes/payments'
import consultantRoutes from './routes/consultant'
import publicRoutes     from './routes/public'
import chatRoutes       from './routes/chat'
import telemostRoutes   from './routes/telemost'
import pushRoutes       from './routes/push'
import tgBotRoutes      from './routes/telegram_bot'

import type { Bindings, Variables } from './types'

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// ---- Middleware ----
app.use('*', logger())
app.use('/api/*', cors({
  origin: ['https://antinarkologia.ru', 'http://localhost:3000'],
  credentials: true
}))

// ---- HTML страницы ----
app.route('/', pagesRoutes)

// ---- API роуты ----
app.route('/api/auth',       authRoutes)
app.route('/api/slots',      slotsRoutes)
app.route('/api/bookings',   bookingsRoutes)
app.route('/api/payments',   paymentsRoutes)
app.route('/api/consultant', consultantRoutes)
app.route('/api/chat',       chatRoutes)
app.route('/api/telemost',   telemostRoutes)
app.route('/api/push',       pushRoutes)
app.route('/api/telegram',   tgBotRoutes)
app.route('/api',            publicRoutes)

// ---- Статика ----
// serveStatic работает корректно в production (Cloudflare Pages)
// В dev-режиме (wrangler pages dev) файлы из public/ отдаются напрямую
app.use('/static/*', serveStatic({ root: './public' }))

// ---- Health check ----
app.get('/api/health', (c) => c.json({ ok: true, version: '1.0.0' }))

// ---- Favicon ----
// В dev-режиме wrangler pages dev отдаёт favicon.ico из public/ напрямую
// Эта заглушка нужна только как fallback
app.get('/favicon.ico', async (c) => {
  try {
    return await serveStatic({ root: './public' })(c, async () => {})
  } catch {
    return c.body('', 204)
  }
})

// ---- robots.txt ----
app.get('/robots.txt', async (c) => {
  try {
    return await serveStatic({ root: './public' })(c, async () => {})
  } catch {
    return c.text('User-agent: *\nAllow: /\n')
  }
})

// ---- SPA fallback — для неизвестных путей возвращаем index.html ----
// Используем импортированный HTML из pages route вместо serveStatic
// чтобы избежать ошибки __STATIC_CONTENT_MANIFEST в dev-режиме
app.get('*', (c) => {
  // Перенаправляем на главную для неизвестных путей
  return c.redirect('/')
})

export default app
