// ============================================================
// АНТИНаркология — главный файл приложения
// ============================================================

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { serveStatic } from 'hono/cloudflare-workers'

import authRoutes      from './routes/auth'
import pagesRoutes    from './routes/pages'
import slotsRoutes     from './routes/slots'
import bookingsRoutes  from './routes/bookings'
import paymentsRoutes  from './routes/payments'
import consultantRoutes from './routes/consultant'
import publicRoutes    from './routes/public'

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
app.route('/api',            publicRoutes)

// ---- Статика ----
app.use('/static/*', serveStatic({ root: './public' }))

// ---- Health check ----
app.get('/api/health', (c) => c.json({ ok: true, version: '1.0.0' }))

// ---- Favicon (заглушка) ----
app.get('/favicon.ico', (c) => c.body('', 204))

// ---- SPA fallback ----
app.get('*', serveStatic({ root: './public', path: '/index.html' }))

export default app
