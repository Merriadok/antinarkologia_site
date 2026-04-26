// ============================================================
// HTML-страницы (раздаются через Hono, не через serveStatic)
// Это нужно потому что wrangler pages dev не умеет
// корректно обслуживать .html через serveStatic в dev-режиме
// ============================================================

import { Hono } from 'hono'
import type { Bindings, Variables } from '../types'

const pages = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// Встраиваем HTML как строки через ?raw import — Vite поддерживает
// В Cloudflare Pages они попадут в _worker.js как константы

// Читаем файлы через Vite raw import
// @ts-ignore
import authHtml       from '../../public/auth.html?raw'
// @ts-ignore
import lkHtml         from '../../public/lk.html?raw'
// @ts-ignore
import consultantHtml from '../../public/consultant.html?raw'

pages.get('/auth.html',       (c) => c.html(authHtml))
pages.get('/lk.html',         (c) => c.html(lkHtml))
pages.get('/consultant.html', (c) => c.html(consultantHtml))

// Удобные редиректы без .html
pages.get('/auth',       (c) => c.redirect('/auth.html'))
pages.get('/lk',         (c) => c.redirect('/lk.html'))
pages.get('/consultant', (c) => c.redirect('/consultant.html'))

export default pages
