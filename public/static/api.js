// ============================================================
// API-клиент и общие утилиты
// Используется на всех страницах ЛК и панели консультанта
// ============================================================

const API = {
  async request(method, path, body) {
    const opts = {
      method,
      credentials: 'include',
      headers: {}
    }
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json'
      opts.body = JSON.stringify(body)
    }
    const resp = await fetch('/api' + path, opts)
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) throw Object.assign(new Error(data.error || 'Ошибка сервера'), { status: resp.status, data })
    return data
  },
  get:    (path)        => API.request('GET',    path),
  post:   (path, body)  => API.request('POST',   path, body),
  patch:  (path, body)  => API.request('PATCH',  path, body),
  delete: (path)        => API.request('DELETE', path),
}

// ---------- Auth ----------

const Auth = {
  _user: null,

  async me() {
    if (this._user) return this._user
    try {
      const { user, role } = await API.get('/auth/me')
      if (user) { this._user = { ...user, role }; return this._user }
    } catch {}
    return null
  },

  async requireAuth(redirectTo = '/auth.html') {
    const user = await this.me()
    if (!user) { window.location.href = redirectTo; return null }
    return user
  },

  async requireConsultant() {
    const user = await this.me()
    if (!user || user.role !== 'consultant') {
      window.location.href = '/auth.html?role=consultant'
      return null
    }
    return user
  },

  async logout() {
    await API.post('/auth/logout')
    this._user = null
    window.location.href = '/'
  },

  clear() { this._user = null }
}

// ---------- Форматирование ----------

const Fmt = {
  date(iso) {
    if (!iso) return '—'
    return new Date(iso).toLocaleString('ru-RU', {
      timeZone: 'Europe/Moscow',
      day: 'numeric', month: 'long', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    })
  },

  dateShort(iso) {
    if (!iso) return '—'
    return new Date(iso).toLocaleString('ru-RU', {
      timeZone: 'Europe/Moscow',
      day: 'numeric', month: 'short',
      hour: '2-digit', minute: '2-digit'
    })
  },

  dayName(iso) {
    return new Date(iso).toLocaleDateString('ru-RU', { weekday: 'short' })
  },

  dayNum(iso) {
    return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', timeZone: 'Europe/Moscow' })
  },

  money(rub) {
    return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(rub)
  },

  statusBadge(status) {
    const map = {
      pending_payment: ['badge-pending',  '⏳ Ожидает оплаты'],
      paid:            ['badge-paid',     '✓ Оплачено'],
      in_progress:     ['badge-info',     '▶ Идёт встреча'],
      completed:       ['badge-done',     '✓ Завершено'],
      cancelled:       ['badge-cancelled','✕ Отменено'],
      refunded:        ['badge-warning',  '↩ Возврат'],
    }
    const [cls, label] = map[status] || ['badge-cancelled', status]
    return `<span class="badge ${cls}">${label}</span>`
  },

  meetingFormat(fmt) {
    const map = {
      telemost: '📹 TeleМост',
      telegram: '💬 Telegram / Макс',
      max:      '💬 Макс',
      phone:    '📞 Телефон',
    }
    return map[fmt] || fmt || '—'
  }
}

// ---------- DOM-утилиты ----------

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v
    else if (k.startsWith('on')) e.addEventListener(k.slice(2).toLowerCase(), v)
    else if (k === 'html') e.innerHTML = v
    else e.setAttribute(k, v)
  }
  for (const c of children) {
    if (c == null) continue
    e.append(typeof c === 'string' ? document.createTextNode(c) : c)
  }
  return e
}

function $(sel, root = document) { return root.querySelector(sel) }
function $$(sel, root = document) { return [...root.querySelectorAll(sel)] }

function showAlert(container, type, text) {
  const icons = { error: '✕', success: '✓', info: 'ℹ', warning: '⚠' }
  container.innerHTML = `<div class="alert alert-${type}">${icons[type] || ''} ${text}</div>`
  setTimeout(() => { if (container.innerHTML) container.innerHTML = '' }, 6000)
}

function setLoading(btn, loading, text) {
  if (loading) {
    btn._origText = btn.innerHTML
    btn.innerHTML = `<span class="spinner"></span> ${text || 'Загрузка...'}`
    btn.disabled = true
  } else {
    btn.innerHTML = btn._origText || btn.innerHTML
    btn.disabled = false
  }
}

// ---------- Toast ----------

function toast(msg, type = 'info', ms = 4000) {
  let wrap = document.getElementById('toast-wrap')
  if (!wrap) {
    wrap = Object.assign(document.createElement('div'), {
      id: 'toast-wrap',
      style: 'position:fixed;bottom:20px;right:20px;z-index:999;display:flex;flex-direction:column;gap:8px;'
    })
    document.body.appendChild(wrap)
  }
  const icons = { error: '✕', success: '✓', info: 'ℹ', warning: '⚠' }
  const colors = { error: '#fee2e2', success: '#dcfce7', info: '#e0f2fe', warning: '#ffedd5' }
  const t = Object.assign(document.createElement('div'), {
    innerHTML: `${icons[type] || ''} ${msg}`,
    style: `background:${colors[type]||'#fff'};padding:12px 16px;border-radius:8px;font-size:14px;
            box-shadow:0 4px 16px rgba(0,0,0,.15);max-width:320px;animation:fadeIn .2s;`
  })
  wrap.appendChild(t)
  setTimeout(() => t.remove(), ms)
}

// ---------- Роутинг по хэшу ----------

const Router = {
  routes: {},
  on(hash, fn) { this.routes[hash] = fn; return this },
  start() {
    const go = () => {
      const hash = location.hash.slice(1) || 'home'
      const fn = this.routes[hash] || this.routes['*']
      if (fn) fn(hash)
    }
    window.addEventListener('hashchange', go)
    go()
  }
}

// ---------- Экспорт в window ----------
window.API    = API
window.Auth   = Auth
window.Fmt    = Fmt
window.el     = el
window.$      = $
window.$$     = $$
window.showAlert = showAlert
window.setLoading = setLoading
window.toast  = toast
window.Router = Router
