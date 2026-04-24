// ============================================================
// АНТИНаркология — главный файл приложения
// ============================================================

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { serveStatic } from 'hono/cloudflare-workers'

import authRoutes      from './routes/auth'
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

// ---- SPA fallback — все остальные пути отдают index.html ----
// Фронтенд (React/Vanilla) обрабатывает маршруты сам
app.get('*', serveStatic({ root: './public', path: '/index.html' }))

export default app
