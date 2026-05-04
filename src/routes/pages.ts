// ============================================================
// HTML-страницы (раздаются через Hono, не через serveStatic)
// Это нужно потому что wrangler pages dev не умеет
// корректно обслуживать .html через serveStatic в dev-режиме
// ============================================================

import { Hono } from 'hono'
import type { Bindings, Variables } from '../types'

const pages = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// Читаем файлы через Vite raw import
// @ts-ignore
import indexHtml        from '../../public/index.html?raw'
// @ts-ignore
import authHtml         from '../../public/auth.html?raw'
// @ts-ignore
import lkHtml           from '../../public/lk.html?raw'
// @ts-ignore
import consultantHtml   from '../../public/consultant.html?raw'
// @ts-ignore
import aboutHtml        from '../../public/about.html?raw'
// @ts-ignore
import consultantsHtml  from '../../public/consultants.html?raw'
// @ts-ignore
import howItWorksHtml   from '../../public/how-it-works.html?raw'
// @ts-ignore
import offerHtml        from '../../public/offer.html?raw'
// @ts-ignore
import privacyHtml      from '../../public/privacy.html?raw'
// @ts-ignore
import termsHtml        from '../../public/terms.html?raw'

// ---- Основные приложения ----
pages.get('/',                 (c) => c.html(indexHtml))
pages.get('/index.html',       (c) => c.html(indexHtml))
pages.get('/auth.html',        (c) => c.html(authHtml))
pages.get('/lk.html',          (c) => c.html(lkHtml))
pages.get('/consultant.html',  (c) => c.html(consultantHtml))

// ---- Лендинг — информационные страницы ----
pages.get('/about.html',       (c) => c.html(aboutHtml))
pages.get('/consultants.html', (c) => c.html(consultantsHtml))
pages.get('/how-it-works.html',(c) => c.html(howItWorksHtml))

// ---- Правовые страницы ----
pages.get('/offer.html',       (c) => c.html(offerHtml))
pages.get('/privacy.html',     (c) => c.html(privacyHtml))
pages.get('/terms.html',       (c) => c.html(termsHtml))

// ---- Удобные редиректы без .html ----
pages.get('/auth',          (c) => c.redirect('/auth.html'))
pages.get('/lk',            (c) => c.redirect('/lk.html'))
pages.get('/consultant',    (c) => c.redirect('/consultant.html'))
pages.get('/about',         (c) => c.redirect('/about.html'))
pages.get('/consultants',   (c) => c.redirect('/consultants.html'))
pages.get('/how-it-works',  (c) => c.redirect('/how-it-works.html'))
pages.get('/offer',         (c) => c.redirect('/offer.html'))
pages.get('/privacy',       (c) => c.redirect('/privacy.html'))
pages.get('/terms',         (c) => c.redirect('/terms.html'))

// ---- Легаси ссылки (старый лендинг использовал /experts.html) ----
pages.get('/experts.html',  (c) => c.redirect('/consultants.html'))
pages.get('/experts',       (c) => c.redirect('/consultants.html'))

export default pages
