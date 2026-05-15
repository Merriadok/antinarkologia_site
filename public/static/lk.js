// ============================================================
// Личный кабинет клиента
// ============================================================

let currentUser = null
let currentPage = 'bookings'

// ---- Инициализация ----

async function init() {
  currentUser = await Auth.requireAuth('/auth.html?next=/lk.html')
  if (!currentUser) return

  // Имя в шапке
  const nameEl = document.getElementById('topbar-name')
  nameEl.textContent = currentUser.display_name || currentUser.login || currentUser.email || 'Кабинет'

  // Навигация
  $$('[data-page]', document.getElementById('sidebar')).forEach(btn => {
    btn.onclick = () => navigate(btn.dataset.page)
  })

  // Проверяем URL-параметры (возврат с оплаты)
  const params = new URLSearchParams(location.search)
  if (params.get('booking') && params.get('status')) {
    await handlePaymentReturn(params.get('booking'), params.get('status'))
    history.replaceState(null, '', location.pathname)
  }

  // Service Worker + Push-уведомления
  initServiceWorker()

  navigate('bookings')
}

// ---- Service Worker ----

async function initServiceWorker() {
  if (!('serviceWorker' in navigator)) return
  try {
    const reg = await navigator.serviceWorker.register('/static/sw.js', { scope: '/' })
    // Планируем напоминания за 10 минут — проверяем каждые 5 мин
    setInterval(() => checkUpcomingReminders(), 5 * 60 * 1000)
    // И сразу при открытии
    checkUpcomingReminders()
    // Настраиваем Push-подписку
    await setupPushSubscription(reg)
  } catch (err) {
    console.warn('SW registration failed:', err)
  }
}

async function setupPushSubscription(registration) {
  try {
    // Проверяем VAPID-ключ
    const { key, enabled } = await API.get('/push/vapid-key')
    if (!enabled) return  // Push не настроен на сервере — молча пропускаем

    // Проверяем уже существующую подписку
    let sub = await registration.pushManager.getSubscription()
    if (!sub) {
      // Запрашиваем разрешение
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') return

      // Создаём подписку
      sub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      })
    }

    // Отправляем на сервер
    const json = sub.toJSON()
    await API.post('/push/subscribe', {
      endpoint: json.endpoint,
      p256dh:   json.keys?.p256dh,
      auth:     json.keys?.auth,
      userAgent: navigator.userAgent,
    })
  } catch (err) {
    console.warn('Push setup error:', err)
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding   = '='.repeat((4 - base64String.length % 4) % 4)
  const base64    = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData   = window.atob(base64)
  const outputArr = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) outputArr[i] = rawData.charCodeAt(i)
  return outputArr
}

// ---- Локальные напоминания (10 минут до встречи) ----
// Работают пока вкладка открыта, не требуют VAPID

async function checkUpcomingReminders() {
  if (Notification.permission !== 'granted') return
  try {
    const { bookings } = await API.get('/bookings/my')
    const now = Date.now()
    const TEN_MIN = 10 * 60 * 1000
    const SHOWN_KEY = 'reminded_bookings'
    const shown = JSON.parse(sessionStorage.getItem(SHOWN_KEY) || '{}')

    bookings
      .filter(b => b.status === 'paid' && b.slot_starts_at)
      .forEach(b => {
        const startsAt = new Date(b.slot_starts_at).getTime()
        const diff = startsAt - now
        // Напоминаем в окне от 15 до 9 минут до встречи
        if (diff > 0 && diff <= 15 * 60 * 1000 && diff >= 9 * 60 * 1000 && !shown[b.id]) {
          shown[b.id] = true
          sessionStorage.setItem(SHOWN_KEY, JSON.stringify(shown))
          showLocalNotification(
            '⏰ Встреча через 10 минут!',
            `${b.tariff_name || 'Совет'} — ${Fmt.date(b.slot_starts_at)}`,
            '/lk.html'
          )
        }
      })
  } catch (_) {}
}

function showLocalNotification(title, body, url) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return
  const notif = new Notification(title, {
    body,
    icon: '/static/favicon.svg',
    tag:  'antinarco-reminder',
    requireInteraction: true,
  })
  notif.onclick = () => { window.focus(); window.location.href = url; notif.close() }
}

async function navigate(page) {
  currentPage = page
  $$('[data-page]').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.page === page)
  )
  const main = document.getElementById('main')
  main.innerHTML = '<div class="loading-overlay"><div class="spinner"></div> Загрузка...</div>'

  try {
    if (page === 'bookings')    await renderBookings()
    if (page === 'new-booking') await renderNewBooking()
    if (page === 'support')     await renderSupport()
    if (page === 'profile')     await renderProfile()
  } catch (err) {
    main.innerHTML = `<div class="alert alert-error">Ошибка загрузки: ${err.message}</div>`
  }
}

// ---- Обработка возврата с оплаты ----

async function handlePaymentReturn(bookingId, status) {
  if (status === 'success') {
    // Небольшая пауза — вебхук может ещё не прийти
    await new Promise(r => setTimeout(r, 1500))
    try {
      const { status: payStatus } = await API.get(`/payments/status/${bookingId}`)
      if (payStatus === 'paid') {
        toast('Оплата прошла успешно! Ждём вас на встрече. 🎉', 'success', 6000)
      } else {
        toast('Платёж обрабатывается — статус обновится автоматически.', 'info')
      }
    } catch {}
  }
}

// ============================================================
// Страница: Мои записи
// ============================================================

async function renderBookings() {
  const { bookings } = await API.get('/bookings/my')
  const main = document.getElementById('main')

  if (bookings.length === 0) {
    main.innerHTML = `
      <h2 style="margin-bottom:20px">Мои записи</h2>
      <div class="empty-state">
        <div class="empty-icon">📋</div>
        <p>У вас пока нет записей</p>
        <div class="empty-hint">Запишитесь на совет — это быстро и анонимно</div>
        <button class="btn btn-primary" style="margin-top:16px" onclick="navigate('new-booking')">
          Записаться на совет
        </button>
      </div>
    `
    return
  }

  const upcoming = bookings.filter(b => ['pending_payment','paid','in_progress'].includes(b.status))
  const past     = bookings.filter(b => ['completed','cancelled','refunded'].includes(b.status))

  let html = `<h2 style="margin-bottom:20px">Мои записи</h2>`

  if (upcoming.length) {
    html += `<h3 style="font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:var(--c-muted);margin-bottom:10px">Предстоящие</h3>`
    html += upcoming.map(b => renderBookingCard(b, true)).join('')
    html += '<div style="margin-bottom:24px"></div>'
  }

  if (past.length) {
    html += `<h3 style="font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:var(--c-muted);margin-bottom:10px">История</h3>`
    html += past.map(b => renderBookingCard(b, false)).join('')
  }

  main.innerHTML = html

  // Вешаем обработчики кнопок
  $$('.btn-pay').forEach(btn => {
    btn.onclick = () => payBooking(btn.dataset.id, btn.dataset.url)
  })
  $$('.btn-cancel-booking').forEach(btn => {
    btn.onclick = () => cancelBooking(btn.dataset.id)
  })
  $$('.btn-check-payment').forEach(btn => {
    btn.onclick = () => checkPayment(btn.dataset.id, btn)
  })
  $$('.btn-accept-time').forEach(btn => {
    btn.onclick = () => respondToProposedTime(btn.dataset.id, true, btn)
  })
  $$('.btn-decline-time').forEach(btn => {
    btn.onclick = () => respondToProposedTime(btn.dataset.id, false, btn)
  })
}

async function respondToProposedTime(bookingId, accept, btn) {
  const msg = accept ? 'Подтверждаем время...' : 'Отклоняем...'
  setLoading(btn, true, msg)
  try {
    await API.post(`/bookings/${bookingId}/respond-time`, { accept })
    toast(accept ? 'Время встречи подтверждено! ✅' : 'Предложение отклонено. Консультант предложит другое время.', accept ? 'success' : 'info', 5000)
    await renderBookings()
  } catch (err) {
    toast(err.message, 'error')
    setLoading(btn, false)
  }
}

function renderBookingCard(b, isUpcoming) {
  // Время: слот / предложенное / по договорённости
  let slot = '📅 По договорённости'
  if (b.slot_starts_at) {
    slot = `📅 ${Fmt.date(b.slot_starts_at)}`
  } else if (b.proposed_time && b.proposed_time_status === 'pending') {
    slot = `📅 <span style="color:#f59e0b;font-weight:600">Предложено: ${Fmt.date(b.proposed_time)} — ожидает вашего ответа</span>`
  } else if (b.proposed_time && b.proposed_time_status === 'declined') {
    slot = `📅 <span style="color:var(--c-muted)">По договорённости</span> <span style="font-size:12px;color:#dc2626">(предложение отклонено)</span>`
  }
  const format  = Fmt.meetingFormat(b.meeting_format)
  const tariff  = b.tariff_name || '—'
  const price   = b.price_rub ? Fmt.money(b.price_rub) : '—'

  // Контакт консультанта и кнопки действий
  let contactBlock = ''
  {
    let contactLinks = []

    // Ссылка на встречу — только если оплачено
    if ((b.status === 'paid' || b.status === 'in_progress') && b.meeting_format === 'telemost') {
      if (b.meeting_link) {
        contactLinks.push(`<a href="${b.meeting_link}" target="_blank" class="btn btn-accent btn-sm">📹 Войти в TeleМост</a>`)
      } else {
        contactLinks.push(`
          <span style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;
                background:#f0f6ff;border-radius:6px;font-size:13px;color:var(--c-muted);border:1px solid var(--c-border)">
            📹 Ссылка TeleМост — будет добавлена консультантом
          </span>`)
      }
    } else if ((b.status === 'paid' || b.status === 'in_progress') && b.meeting_format === 'telegram') {
      // Умный блок для формата "Telegram"
      const hasTgUrl     = !!b.consultant_telegram_url
      const clientHasTg  = !!(currentUser.telegram_username || currentUser.telegram_bot_chat_id)

      if (hasTgUrl) {
        // Консультант заполнил ссылку — показываем кнопку
        contactLinks.push(`<a href="${b.consultant_telegram_url}" target="_blank" class="btn btn-outline btn-sm">✈️ Telegram консультанта</a>`)
        if (!clientHasTg) {
          // У клиента нет TG-контакта — предупреждение
          contactLinks.push(`
            <div style="display:flex;align-items:flex-start;gap:8px;padding:8px 12px;background:#fffbeb;
                        border:1px solid #fcd34d;border-radius:8px;font-size:13px;color:#92400e;max-width:360px">
              <span style="flex-shrink:0">⚠️</span>
              <span>Чтобы консультант мог найти вас в Telegram, укажите <strong>@username</strong> или подключите бота в
                <button onclick="navigate('profile')" style="background:none;border:none;padding:0;color:#92400e;
                  text-decoration:underline;cursor:pointer;font-size:inherit">профиле</button>.
              </span>
            </div>`)
        }
      } else {
        // Консультант ещё не заполнил telegram_url
        if (clientHasTg) {
          // Клиент есть в TG — сообщаем что консультант напишет сам
          contactLinks.push(`
            <span style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;
                  background:#f0f6ff;border-radius:6px;font-size:13px;color:var(--c-muted);border:1px solid var(--c-border)">
              ✈️ Консультант свяжется с вами в Telegram
            </span>`)
        } else {
          // Нет ни ссылки консультанта, ни TG у клиента — двойное предупреждение
          contactLinks.push(`
            <div style="display:flex;align-items:flex-start;gap:8px;padding:8px 12px;background:#fffbeb;
                        border:1px solid #fcd34d;border-radius:8px;font-size:13px;color:#92400e;max-width:360px">
              <span style="flex-shrink:0">⚠️</span>
              <span>Укажите <strong>@username Telegram</strong> или подключите бота, чтобы консультант смог с вами связаться. →
                <button onclick="navigate('profile')" style="background:none;border:none;padding:0;color:#92400e;
                  text-decoration:underline;cursor:pointer;font-size:inherit">Перейти в профиль</button>
              </span>
            </div>`)
        }
      }
    } else if ((b.status === 'paid' || b.status === 'in_progress') && b.meeting_format === 'max') {
      contactLinks.push(`<span style="font-size:13px;color:var(--c-muted);padding:6px 0;display:inline-block">💙 Консультант напишет в Макс в согласованное время</span>`)
    } else if ((b.status === 'paid' || b.status === 'in_progress') && b.meeting_format === 'phone') {
      contactLinks.push(`<span style="font-size:13px;color:var(--c-muted);padding:6px 0;display:inline-block">📞 Консультант позвонит в согласованное время</span>`)
    }

    // Кнопка чата — для ВСЕХ активных записей (в т.ч. pending_payment)
    if (['pending_payment', 'paid', 'in_progress'].includes(b.status)) {
      contactLinks.push(`<button class="btn btn-outline btn-sm" onclick="openChat(${b.id})">💬 Чат с консультантом</button>`)
    }

    // История чата — для завершённых/отменённых записей (readonly)
    if (['cancelled', 'completed', 'refunded'].includes(b.status)) {
      contactLinks.push(`<button class="btn btn-outline btn-sm" onclick="openChat(${b.id}, true)">📜 История чата</button>`)
    }

    // Кнопка «Выбрать время» — если слот не выбран и нет pending-предложения
    if (!b.slot_starts_at && !b.proposed_time && ['pending_payment', 'paid'].includes(b.status)) {
      contactLinks.push(`<button class="btn btn-outline btn-sm" onclick="openChooseSlot(${b.id})">📅 Выбрать время</button>`)
    }

    if (contactLinks.length) {
      contactBlock = `<div style="margin:10px 0 0;display:flex;flex-wrap:wrap;gap:8px;align-items:center">${contactLinks.join('')}</div>`
    }
  }

  // Блок подтверждения предложенного времени
  let proposeBlock = ''
  if (b.proposed_time_status === 'pending' && ['paid', 'pending_payment'].includes(b.status)) {
    proposeBlock = `
      <div style="margin:10px 0;padding:12px 14px;background:#fffbeb;border:1px solid #f59e0b;border-radius:8px">
        <div style="font-size:13px;font-weight:600;color:#92400e;margin-bottom:8px">
          📅 Консультант предлагает время встречи: <strong>${Fmt.date(b.proposed_time)}</strong>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-primary btn-sm btn-accept-time" data-id="${b.id}">✅ Подтвердить</button>
          <button class="btn btn-ghost btn-sm btn-decline-time" data-id="${b.id}">❌ Не подходит</button>
        </div>
      </div>`
  }

  // Действия
  let actions = ''
  if (b.status === 'pending_payment') {
    const payUrl = b.confirmation_url || ''
    if (payUrl) {
      actions += `<a href="${payUrl}" class="btn btn-accent btn-sm btn-pay" data-id="${b.id}" data-url="${payUrl}">💳 Оплатить</a>`
    }
    actions += `<button class="btn btn-ghost btn-sm btn-check-payment" data-id="${b.id}">🔄 Проверить оплату</button>`
    actions += `<button class="btn btn-danger btn-sm btn-cancel-booking" data-id="${b.id}">Отменить</button>`
  }

  return `
    <div class="booking-card" id="booking-${b.id}">
      <div class="booking-header">
        <div>
          <div class="booking-title">${tariff}</div>
          <div class="booking-date">${slot}</div>
        </div>
        ${Fmt.statusBadge(b.status)}
      </div>
      <div class="booking-meta">
        <span class="booking-meta-item">${format}</span>
        <span class="booking-meta-item">· ${price}</span>
        ${b.paid_at ? `<span class="booking-meta-item">· Оплачено ${Fmt.dateShort(b.paid_at)}</span>` : ''}
      </div>
      ${b.client_question ? `<div style="font-size:13px;color:var(--c-muted);font-style:italic;margin-top:4px">"${b.client_question}"</div>` : ''}
      ${proposeBlock}
      ${contactBlock}
      ${actions ? `<div class="booking-actions">${actions}</div>` : ''}
    </div>
  `
}

async function payBooking(id, url) {
  if (url) { window.location.href = url; return }
  toast('Ссылка для оплаты недоступна. Попробуйте создать запись заново.', 'warning')
}

async function checkPayment(bookingId, btn) {
  setLoading(btn, true, 'Проверяю...')
  try {
    const { status } = await API.get(`/payments/status/${bookingId}`)
    if (status === 'paid') {
      toast('Оплата подтверждена! 🎉', 'success')
      await renderBookings()
    } else {
      toast('Оплата пока не поступила. Проверьте ещё раз через минуту.', 'info')
    }
  } catch (err) {
    toast(err.message, 'error')
  } finally {
    setLoading(btn, false)
  }
}

async function cancelBooking(id) {
  if (!confirm('Отменить запись? Если оплата уже прошла — свяжитесь с нами для возврата.')) return
  try {
    await API.post(`/bookings/${id}/cancel`)
    toast('Запись отменена', 'info')
    await renderBookings()
  } catch (err) {
    toast(err.message, 'error')
  }
}

// ============================================================
// Страница: Новая запись
// ============================================================

let bookingState = {
  step: 1,           // 1=формат, 2=слот, 3=вопрос, 4=оплата
  format: null,
  slotId: null,
  slotDate: null,
  tariffId: null,
  consultantId: 1,
  question: '',
  contact: ''
}

async function renderNewBooking() {
  // Загружаем тариф "Совет"
  const { tariffs } = await API.get('/tariffs')
  const advice = tariffs.find(t => t.is_advice) || tariffs[0]
  bookingState.tariffId = advice?.id

  const main = document.getElementById('main')
  main.innerHTML = `
    <h2 style="margin-bottom:4px">Записаться на совет</h2>
    <p style="color:var(--c-muted);font-size:14px;margin-bottom:24px">
      ${advice ? advice.name + ' — ' + Fmt.money(advice.price_rub) : ''}
      ${advice?.description ? '· ' + advice.description : ''}
    </p>

    <!-- Прогресс -->
    <div id="booking-progress" style="display:flex;gap:8px;margin-bottom:24px;align-items:center"></div>

    <!-- Контент шага -->
    <div id="booking-step-content"></div>

    <!-- Алерты -->
    <div id="booking-alert" style="margin-top:12px"></div>
  `
  renderBookingStep()
}

function updateProgress() {
  const steps = [
    { n: 1, label: 'Формат' },
    { n: 2, label: 'Время' },
    { n: 3, label: 'Вопрос' },
    { n: 4, label: 'Оплата' },
  ]
  document.getElementById('booking-progress').innerHTML = steps.map(s => `
    <div style="display:flex;align-items:center;gap:6px">
      <div style="
        width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;
        font-size:13px;font-weight:700;flex-shrink:0;
        background:${bookingState.step > s.n ? '#dcfce7' : bookingState.step === s.n ? 'var(--c-primary)' : 'var(--c-border)'};
        color:${bookingState.step > s.n ? 'var(--c-success)' : bookingState.step === s.n ? '#fff' : 'var(--c-muted)'}
      ">${bookingState.step > s.n ? '✓' : s.n}</div>
      <span style="font-size:13px;color:${bookingState.step === s.n ? 'var(--c-text)' : 'var(--c-muted)'}">${s.label}</span>
      ${s.n < 4 ? '<span style="color:var(--c-border)">›</span>' : ''}
    </div>
  `).join('')
}

function renderBookingStep() {
  updateProgress()
  const cont = document.getElementById('booking-step-content')

  if (bookingState.step === 1) renderStepFormat(cont)
  if (bookingState.step === 2) renderStepSlot(cont)
  if (bookingState.step === 3) renderStepQuestion(cont)
  if (bookingState.step === 4) renderStepConfirm(cont)
}

// Шаг 1: Выбор формата встречи
function renderStepFormat(cont) {
  const formats = [
    { id: 'telemost', icon: '📹', label: 'TeleМост', desc: 'Видеозвонок в браузере' },
    { id: 'telegram', icon: '💬', label: 'Telegram / Макс', desc: 'Голосовой или видеозвонок' },
    { id: 'phone',    icon: '📞', label: 'Телефон', desc: 'Обычный звонок' },
  ]

  cont.innerHTML = `
    <div class="card">
      <div class="card-header"><div class="card-title">Как удобнее поговорить?</div></div>
      <div class="card-body">
        <div class="format-grid" id="format-grid">
          ${formats.map(f => `
            <div class="format-option ${bookingState.format === f.id ? 'selected' : ''}"
                 data-fmt="${f.id}" onclick="selectFormat('${f.id}')">
              <div class="fmt-icon">${f.icon}</div>
              <div class="fmt-label">${f.label}</div>
              <div style="font-size:12px;color:var(--c-muted);margin-top:3px">${f.desc}</div>
            </div>
          `).join('')}
        </div>

        <div id="contact-field" style="display:${bookingState.format && bookingState.format !== 'telemost' ? '' : 'none'};margin-top:16px">
          <div class="form-group">
            <label class="form-label" id="contact-label">Ваш контакт</label>
            <input class="form-input" id="contact-input" type="text"
              placeholder="@username или номер телефона"
              value="${bookingState.contact}"
              oninput="bookingState.contact = this.value">
            <div class="form-hint" id="contact-hint">Консультант напишет первым в согласованное время</div>
          </div>
        </div>

        <div style="margin-top:20px;display:flex;justify-content:flex-end">
          <button class="btn btn-primary" id="btn-format-next"
            ${bookingState.format ? '' : 'disabled'}
            onclick="bookingNextStep()">
            Далее — выбрать время →
          </button>
        </div>
      </div>
    </div>
  `
}

function selectFormat(fmt) {
  bookingState.format = fmt
  $$('.format-option').forEach(el => el.classList.toggle('selected', el.dataset.fmt === fmt))
  document.getElementById('btn-format-next').disabled = false

  // Контактное поле
  const contactField = document.getElementById('contact-field')
  const contactLabel = document.getElementById('contact-label')
  const contactHint  = document.getElementById('contact-hint')
  contactField.style.display = fmt !== 'telemost' ? '' : 'none'
  if (fmt === 'telegram') {
    contactLabel.textContent = 'Ваш Telegram или Макс'
    contactHint.textContent  = '@username в Telegram или ссылка на Макс'
  } else if (fmt === 'phone') {
    contactLabel.textContent = 'Ваш номер телефона'
    contactHint.textContent  = 'Консультант позвонит в согласованное время'
  }
}

// Шаг 2: Выбор слота
async function renderStepSlot(cont) {
  cont.innerHTML = '<div class="loading-overlay"><div class="spinner"></div> Загружаем расписание...</div>'

  // Загружаем слоты на ближайшие 30 дней
  const from = new Date()
  const to   = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
  // Даты для API передаём в МСК (UTC+3), чтобы не получить соседний день
  const toStr   = mskDateStr(to)
  const fromStr = mskDateStr(from)

  let slots = []
  try {
    const resp = await API.get(`/slots?consultant_id=1&from=${fromStr}&to=${toStr}`)
    slots = resp.slots || []
  } catch {}

  // Группируем по дням
  const byDay = {}
  slots.forEach(s => {
    const day = new Date(s.starts_at).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' })
    if (!byDay[day]) byDay[day] = []
    byDay[day].push(s)
  })

  const days = Object.keys(byDay)

  if (days.length === 0) {
    cont.innerHTML = `
      <div class="card">
        <div class="card-header"><div class="card-title">Выберите время</div></div>
        <div class="card-body">
          <div class="alert alert-info">
            Свободных слотов пока нет. Мы сами свяжемся с вами для выбора удобного времени —
            просто заполните вопрос на следующем шаге.
          </div>
          <div style="display:flex;gap:8px;margin-top:12px">
            <button class="btn btn-outline btn-sm" onclick="bookingPrevStep()">← Назад</button>
            <button class="btn btn-primary" onclick="bookingState.slotId=null;bookingState.slotDate=null;bookingNextStep()">
              Продолжить без выбора времени →
            </button>
          </div>
        </div>
      </div>
    `
    return
  }

  let selectedDay = days[0]

  function renderSlotPicker() {
    const daySlots = byDay[selectedDay] || []
    return `
      <div class="card">
        <div class="card-header"><div class="card-title">Выберите удобное время</div></div>
        <div class="card-body">
          <div style="font-size:12px;color:var(--c-muted);margin-bottom:12px;display:flex;align-items:center;gap:4px">🕐 Всё время московское (МСК, UTC+3)</div>
          <div class="slot-days" id="slot-days">
            ${days.map(d => {
              const firstSlot = byDay[d][0]
              const date = new Date(firstSlot.starts_at)
              return `
                <button class="day-btn ${d === selectedDay ? 'active' : ''}"
                        onclick="selectDay('${d}')">
                  <span class="day-num">${date.toLocaleDateString('ru-RU',{day:'numeric',timeZone:'Europe/Moscow'})}</span>
                  <span class="day-name">${date.toLocaleDateString('ru-RU',{weekday:'short',timeZone:'Europe/Moscow'})}</span>
                </button>
              `
            }).join('')}
          </div>

          <div class="time-slots" id="time-slots">
            ${daySlots.map(s => {
              const time = new Date(s.starts_at).toLocaleTimeString('ru-RU', {
                hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow'
              })
              return `
                <button class="time-slot ${bookingState.slotId === s.id ? 'selected' : ''}"
                        onclick="selectSlot(${s.id}, '${s.starts_at}')">
                  ${time}
                </button>
              `
            }).join('')}
          </div>

          <div style="display:flex;gap:8px;margin-top:20px">
            <button class="btn btn-outline btn-sm" onclick="bookingPrevStep()">← Назад</button>
            <button class="btn btn-primary" id="btn-slot-next"
              ${bookingState.slotId ? '' : 'disabled'}
              onclick="bookingNextStep()">
              Далее →
            </button>
            <button class="btn btn-ghost btn-sm" onclick="bookingState.slotId=null;bookingState.slotDate=null;bookingNextStep()">
              Пропустить — без конкретного времени
            </button>
          </div>
        </div>
      </div>
    `
  }

  cont.innerHTML = renderSlotPicker()

  window.selectDay = (d) => {
    selectedDay = d
    cont.innerHTML = renderSlotPicker()
  }
  window.selectSlot = (id, starts_at) => {
    bookingState.slotId   = id
    bookingState.slotDate = starts_at
    $$('.time-slot').forEach(el => el.classList.toggle('selected', el.textContent.trim() ===
      new Date(starts_at).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Moscow'})
    ))
    document.getElementById('btn-slot-next').disabled = false
  }
}

// Шаг 3: Вопрос / ситуация
function renderStepQuestion(cont) {
  const slotInfo = bookingState.slotDate
    ? `<div class="alert alert-info" style="margin-bottom:14px">📅 Вы выбрали: <strong>${Fmt.date(bookingState.slotDate)}</strong></div>`
    : `<div class="alert alert-warning" style="margin-bottom:14px">Время не выбрано — консультант свяжется с вами для его согласования.</div>`

  cont.innerHTML = `
    <div class="card">
      <div class="card-header"><div class="card-title">Опишите ситуацию</div></div>
      <div class="card-body">
        ${slotInfo}
        <div class="form-group">
          <label class="form-label">Ваш вопрос или ситуация <span style="color:var(--c-muted);font-weight:400">(необязательно)</span></label>
          <textarea class="form-textarea" id="question-input" rows="5"
            placeholder="Опишите, что вас беспокоит, кратко или подробно — как вам удобнее. Всё конфиденциально."
            oninput="bookingState.question = this.value">${bookingState.question}</textarea>
          <div class="form-hint">Это помогает консультанту подготовиться заранее. Можно оставить пустым.</div>
        </div>

        <div style="display:flex;gap:8px;margin-top:4px">
          <button class="btn btn-outline btn-sm" onclick="bookingPrevStep()">← Назад</button>
          <button class="btn btn-primary" onclick="bookingNextStep()">Перейти к оплате →</button>
        </div>
      </div>
    </div>
  `
}

// Шаг 4: Подтверждение и оплата
async function renderStepConfirm(cont) {
  const { tariffs } = await API.get('/tariffs')
  const advice = tariffs.find(t => t.id === bookingState.tariffId) || tariffs[0]

  const fmtMap = { telemost: '📹 TeleМост', telegram: '💬 Telegram / Макс', max: '💬 Макс', phone: '📞 Телефон' }

  cont.innerHTML = `
    <div class="card">
      <div class="card-header"><div class="card-title">Подтвердите запись и перейдите к оплате</div></div>
      <div class="card-body">
        <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
          <tr><td style="padding:8px 0;color:var(--c-muted);font-size:14px;width:40%">Услуга</td>
              <td style="padding:8px 0;font-size:14px;font-weight:600">${advice?.name || 'Совет'}</td></tr>
          <tr><td style="padding:8px 0;color:var(--c-muted);font-size:14px">Время</td>
              <td style="padding:8px 0;font-size:14px">${bookingState.slotDate ? Fmt.date(bookingState.slotDate) : 'По договорённости'}</td></tr>
          <tr><td style="padding:8px 0;color:var(--c-muted);font-size:14px">Формат</td>
              <td style="padding:8px 0;font-size:14px">${fmtMap[bookingState.format] || bookingState.format}</td></tr>
          ${bookingState.contact ? `<tr><td style="padding:8px 0;color:var(--c-muted);font-size:14px">Ваш контакт</td>
              <td style="padding:8px 0;font-size:14px">${bookingState.contact}</td></tr>` : ''}
          <tr style="border-top:1px solid var(--c-border)">
            <td style="padding:12px 0 4px;font-weight:700">К оплате</td>
            <td style="padding:12px 0 4px;font-size:20px;font-weight:700;color:var(--c-primary)">${Fmt.money(advice?.price_rub || 1000)}</td>
          </tr>
        </table>

        <div class="alert alert-info" style="font-size:13px">
          После оплаты вы получите подтверждение. Деньги списываются только один раз — никаких скрытых платежей.
        </div>

        <div id="confirm-alert"></div>

        <div style="display:flex;gap:8px;margin-top:16px">
          <button class="btn btn-outline btn-sm" onclick="bookingPrevStep()">← Назад</button>
          <button class="btn btn-accent btn-lg" id="btn-pay" onclick="submitBooking()">
            💳 Оплатить ${Fmt.money(advice?.price_rub || 1000)}
          </button>
        </div>
        <p style="font-size:12px;color:var(--c-muted);margin-top:10px">
          Оплата через ЮKassa — банковская карта или СБП. Безопасно.
        </p>
      </div>
    </div>
  `
}

async function submitBooking() {
  const btn = document.getElementById('btn-pay')
  const alertBox = document.getElementById('confirm-alert')
  setLoading(btn, true, 'Создаём запись...')

  try {
    const body = {
      consultant_id:  bookingState.consultantId,
      slot_id:        bookingState.slotId || undefined,
      tariff_id:      bookingState.tariffId,
      meeting_format: bookingState.format,
      client_question: bookingState.question || undefined,
      client_contact: bookingState.contact || undefined,
    }

    const { paymentUrl, bookingId } = await API.post('/bookings', body)

    if (paymentUrl && paymentUrl.includes('yookassa')) {
      // Реальная ЮKassa — редиректим
      window.location.href = paymentUrl
    } else {
      // Dev-режим — показываем успех
      showAlert(alertBox, 'success', `Запись #${bookingId} создана! В рабочем режиме здесь будет переход к оплате.`)
      setTimeout(() => navigate('bookings'), 2000)
    }
  } catch (err) {
    showAlert(alertBox, 'error', err.message)
    setLoading(btn, false)
  }
}

function bookingNextStep() {
  bookingState.step++
  renderBookingStep()
}
function bookingPrevStep() {
  bookingState.step--
  renderBookingStep()
}

// ============================================================
// Страница: Сопровождение
// ============================================================

async function renderSupport() {
  const { contracts } = await API.get('/user/support-contracts')
  const main = document.getElementById('main')

  const statusMap = {
    awaiting_payment: ['badge-warning',  'Ожидает оплаты'],
    active:           ['badge-paid',     'Активно'],
    completed:        ['badge-done',     'Завершено'],
    cancelled:        ['badge-cancelled','Отменено'],
  }

  main.innerHTML = `
    <h2 style="margin-bottom:6px">Сопровождение</h2>
    <p style="color:var(--c-muted);font-size:14px;margin-bottom:24px">
      Сопровождение предлагает консультант после первичной консультации. Здесь вы можете его оплатить.
    </p>

    ${contracts.length === 0 ? `
      <div class="empty-state">
        <div class="empty-icon">🤝</div>
        <p>Предложений сопровождения пока нет</p>
        <div class="empty-hint">Если консультант предложит вам сопровождение — оно появится здесь</div>
      </div>
    ` : contracts.map(c => {
      const [badgeClass, badgeLabel] = statusMap[c.status] || ['badge-cancelled', c.status]
      const price = c.custom_price_rub || c.tariff_price
      return `
        <div class="booking-card" style="margin-bottom:12px">
          <div class="booking-header">
            <div>
              <div class="booking-title">${c.tariff_name}</div>
              ${c.starts_at ? `<div class="booking-date">С ${Fmt.dateShort(c.starts_at)} по ${Fmt.dateShort(c.ends_at)}</div>` : ''}
            </div>
            <span class="badge ${badgeClass}">${badgeLabel}</span>
          </div>
          ${c.consultant_comment ? `
            <div style="font-size:14px;color:var(--c-muted);margin:8px 0;padding:10px 12px;background:var(--c-bg);border-radius:7px">
              💬 ${c.consultant_comment}
            </div>
          ` : ''}
          <div style="font-size:18px;font-weight:700;color:var(--c-primary);margin:10px 0">${Fmt.money(price)}</div>
          ${c.status === 'awaiting_payment' ? `
            <div class="booking-actions">
              <button class="btn btn-accent" onclick="paySupport(${c.id})">💳 Оплатить</button>
            </div>
          ` : ''}
        </div>
      `
    }).join('')}

    <div class="alert alert-info" style="margin-top:20px;font-size:13px">
      <strong>Как работает сопровождение?</strong><br>
      После первичного «совета» консультант может предложить более глубокую работу: регулярный контакт,
      корректировку плана, помощь на каждом этапе. Условия всегда обсуждаются индивидуально.
    </div>
  `

  window.paySupport = async (id) => {
    try {
      const { paymentUrl } = await API.post(`/user/support-contracts/${id}/pay`)
      if (paymentUrl && paymentUrl.includes('yookassa')) {
        window.location.href = paymentUrl
      } else {
        toast('Dev-режим: в рабочей версии здесь будет переход к оплате', 'info')
      }
    } catch (err) {
      toast(err.message, 'error')
    }
  }
}

// ============================================================
// Страница: Профиль
// ============================================================

async function renderProfile() {
  const { user } = await API.get('/user/profile')
  const main = document.getElementById('main')

  main.innerHTML = `
    <h2 style="margin-bottom:24px">Профиль</h2>

    <div class="card" style="max-width:520px">
      <div class="card-header"><div class="card-title">Личные данные</div></div>
      <div class="card-body">
        <div id="profile-alert"></div>

        <!-- Поле «Как обращаться» — для всех типов аккаунтов -->
        <div class="form-group">
          <label class="form-label">Как к вам обращаться?</label>
          <input class="form-input" id="p-name" value="${user.display_name || ''}" placeholder="Имя или псевдоним">
          <div class="form-hint">Консультант будет обращаться к вам так</div>
        </div>

        ${!user.is_anonymous ? `
          <div class="form-group">
            <label class="form-label">Email</label>
            <input class="form-input" id="p-email" value="${user.email || ''}" disabled
              style="background:var(--c-bg);color:var(--c-muted)">
            <div class="form-hint">Email изменить нельзя — он используется для входа</div>
          </div>
        ` : `
          <div class="alert alert-info" style="margin-bottom:8px;font-size:13px">
            Вы используете анонимный аккаунт. Укажите email, чтобы получать уведомления.
          </div>
          <div class="form-group">
            <label class="form-label">Email <span style="font-weight:400;color:var(--c-muted)">(необязательно)</span></label>
            <input class="form-input" id="p-email-anon" type="email"
              value="${user.email || ''}" placeholder="your@email.com">
            <div class="form-hint">Используется только для уведомлений, вход через логин/пароль не изменится</div>
          </div>
        `}

        <div class="form-group">
          <label class="form-label">Телефон <span style="font-weight:400;color:var(--c-muted)">(необязательно)</span></label>
          <input class="form-input" id="p-phone" value="${user.phone || ''}" placeholder="+7 (___) ___-__-__">
        </div>

        <div style="margin-bottom:4px;font-size:13px;font-weight:600;color:var(--c-muted);text-transform:uppercase;letter-spacing:.05em;margin-top:8px">
          Мессенджеры
        </div>
        <div class="form-group">
          <label class="form-label">Telegram</label>
          <input class="form-input" id="p-tg" value="${user.telegram_username || ''}" placeholder="@username">
          <div class="form-hint">Консультант сможет написать вам напрямую</div>
        </div>
        <div class="form-group">
          <label class="form-label">Макс (VK)</label>
          <input class="form-input" id="p-max" value="${user.max_profile || ''}" placeholder="Ссылка на профиль">
        </div>

        <!-- Галочка notify_email: для анонима без email — серая с подсказкой -->
        ${(user.is_anonymous && !user.email) ? `
          <div class="form-group" style="display:flex;align-items:center;gap:10px;opacity:0.5">
            <input type="checkbox" id="p-notify" disabled style="width:16px;height:16px">
            <label for="p-notify" style="font-size:14px;cursor:not-allowed">
              Получать уведомления на email
            </label>
          </div>
          <div class="form-hint" style="margin-top:-10px;margin-bottom:12px">
            Укажите email выше, чтобы включить уведомления
          </div>
        ` : `
          <div class="form-group" style="display:flex;align-items:center;gap:10px">
            <input type="checkbox" id="p-notify" ${user.notify_email ? 'checked' : ''} style="width:16px;height:16px">
            <label for="p-notify" style="font-size:14px;cursor:pointer">
              Получать уведомления на email
            </label>
          </div>
        `}

        <button class="btn btn-primary" onclick="saveProfile()">Сохранить</button>
      </div>
    </div>

    <!-- Telegram-бот -->
    <div class="card" style="max-width:520px;margin-top:16px">
      <div class="card-header"><div class="card-title">📱 Telegram-бот уведомлений</div></div>
      <div class="card-body">
        ${user.telegram_bot_chat_id ? `
          <div class="alert alert-info" style="margin-bottom:12px">
            ✅ Telegram подключён — вы получаете уведомления и можете писать боту.
          </div>
          <a href="https://t.me/antinarkologia_bot" target="_blank" class="btn btn-outline btn-sm">
            Открыть бот в Telegram
          </a>
        ` : `
          <p style="font-size:14px;color:var(--c-muted);margin-bottom:14px;line-height:1.6">
            Подключите Telegram, чтобы получать уведомления о встречах, ответах консультанта
            и напоминания прямо в мессенджер.
          </p>
          <button class="btn btn-primary btn-sm" onclick="connectTelegram(${user.id})">
            ✈️ Подключить Telegram
          </button>
          <div class="form-hint" style="margin-top:8px">
            Нажмите кнопку — откроется бот, нажмите в нём «Старт»
          </div>

          <!-- Fallback: показывается если deeplink не сработал (бот уже был открыт) -->
          <div id="tg-fallback" style="display:none;margin-top:16px;padding:14px 16px;
               background:#fffbeb;border:1px solid #f59e0b;border-radius:8px">
            <div style="font-size:13px;font-weight:600;color:#92400e;margin-bottom:8px">
              ⚠️ Бот уже был открыт? Введите код вручную
            </div>
            <p style="font-size:13px;color:var(--c-muted);margin-bottom:10px;line-height:1.5">
              Если бот Telegram уже был открыт ранее — автоматический код не передаётся.
              Откройте бота и отправьте ему это сообщение:
            </p>
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
              <code style="font-family:monospace;font-size:14px;font-weight:700;
                           background:#fff;padding:6px 12px;border-radius:6px;
                           border:1px solid #f59e0b;flex:1;user-select:all;word-break:break-all"
                    id="tg-fallback-code"></code>
              <button onclick="copyTelegramCode()" class="btn btn-outline btn-sm"
                      style="white-space:nowrap;border-color:#f59e0b;color:#92400e">
                📋 Копировать
              </button>
            </div>
            <div style="font-size:12px;color:var(--c-muted)">
              Или напишите боту: <strong>/start [код выше]</strong>
            </div>
            <div style="margin-top:10px">
              <a href="https://t.me/antinarkologia_bot" target="_blank"
                 class="btn btn-outline btn-sm">
                ✈️ Открыть бота ещё раз
              </a>
            </div>
          </div>
        `}
      </div>
    </div>

    ${user.is_anonymous ? buildAnonCredentialsCard(user.login) : ''}
  `
}

// Кнопка «Подключить Telegram» — открывает бота с кодом подтверждения
// Если deeplink ?start= не сработал (бот уже открыт) — показываем fallback с кодом
function connectTelegram(userId) {
  const code = btoa(String(userId))
  const botUrl = `https://t.me/antinarkologia_bot?start=${code}`

  // Открываем бот в новой вкладке
  window.open(botUrl, '_blank')

  // Через 1.5 сек показываем fallback-блок с кодом для ручного ввода
  // (на случай если бот уже открыт и deeplink ?start= не передался)
  setTimeout(() => {
    const fallback = document.getElementById('tg-fallback')
    if (!fallback) return
    fallback.style.display = 'block'
    document.getElementById('tg-fallback-code').textContent = code
  }, 1500)
}
window.connectTelegram = connectTelegram

// Копировать код в буфер обмена
function copyTelegramCode() {
  const code = document.getElementById('tg-fallback-code')?.textContent
  if (!code) return
  navigator.clipboard.writeText(code).then(() => {
    toast('Код скопирован в буфер обмена', 'success', 2000)
  }).catch(() => {
    // fallback для старых браузеров
    const sel = window.getSelection()
    const range = document.createRange()
    range.selectNodeContents(document.getElementById('tg-fallback-code'))
    sel.removeAllRanges()
    sel.addRange(range)
  })
}
window.copyTelegramCode = copyTelegramCode

// Строим карточку «Данные для входа» для анонима
function buildAnonCredentialsCard(login) {
  const pwd = sessionStorage.getItem('anon_pwd_hint') || ''
  // Если пароль есть в sessionStorage — показываем его сразу (скрытым),
  // если нет — показываем поле для ввода вручную, чтобы пользователь мог пересохранить
  const hasPwd = pwd.length > 0

  return `
    <div class="card" style="max-width:520px;margin-top:16px;border:2px solid #f59e0b">
      <div class="card-header" style="background:#fffbeb">
        <div class="card-title" style="color:#92400e">⚠ Данные для входа — сохраните!</div>
      </div>
      <div class="card-body">
        <p style="font-size:14px;color:var(--c-muted);line-height:1.6;margin-bottom:14px">
          Анонимный аккаунт — если забудете логин или пароль,
          восстановить доступ будет <strong>невозможно</strong>.
        </p>

        <div style="padding:14px 16px;background:#f8f7f4;border-radius:8px;border:1px solid var(--c-border)">

          <!-- Логин -->
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
            <span style="font-size:13px;color:var(--c-muted);min-width:60px">Логин:</span>
            <code style="font-family:monospace;font-size:15px;font-weight:700;
                         background:#fff;padding:4px 10px;border-radius:5px;
                         border:1px solid var(--c-border);flex:1;user-select:all">${login}</code>
          </div>

          <!-- Пароль -->
          <div style="display:flex;align-items:center;gap:12px">
            <span style="font-size:13px;color:var(--c-muted);min-width:60px">Пароль:</span>
            ${hasPwd ? `
              <div style="display:flex;align-items:center;gap:8px;flex:1">
                <code id="anon-pwd-val"
                  style="font-family:monospace;font-size:15px;font-weight:700;
                         background:#fff;padding:4px 10px;border-radius:5px;
                         border:1px solid var(--c-border);flex:1;
                         letter-spacing:.12em;user-select:all"
                  data-pwd="${pwd.replace(/"/g,'&quot;')}"
                  data-visible="0">••••••••</code>
                <button onclick="toggleAnonPwd()"
                  id="btn-toggle-pwd"
                  style="background:none;border:1px solid var(--c-border);border-radius:5px;
                         padding:4px 10px;cursor:pointer;font-size:13px;white-space:nowrap;
                         color:var(--c-primary)">
                  👁 Показать
                </button>
              </div>
            ` : `
              <div style="flex:1">
                <input type="password" id="anon-pwd-input" class="form-input"
                  placeholder="Введите ваш пароль, чтобы сохранить его здесь"
                  style="font-family:monospace;letter-spacing:.08em">
                <div style="display:flex;gap:6px;margin-top:6px">
                  <button onclick="rememberAnonPwd()" class="btn btn-outline btn-sm">
                    💾 Сохранить для показа
                  </button>
                  <button onclick="document.getElementById('anon-pwd-input').type =
                    document.getElementById('anon-pwd-input').type === 'password' ? 'text' : 'password'"
                    class="btn btn-ghost btn-sm">👁</button>
                </div>
                <div class="form-hint" style="margin-top:6px">
                  Пароль хранится только в вашем браузере и нигде не передаётся
                </div>
              </div>
            `}
          </div>
        </div>

        <p style="font-size:12px;color:var(--c-muted);margin-top:12px;text-align:center">
          📷 Сфотографируйте этот экран или запишите данные в надёжном месте
        </p>
      </div>
    </div>
  `
}

// Показать / скрыть пароль (если он есть в sessionStorage)
function toggleAnonPwd() {
  const code = document.getElementById('anon-pwd-val')
  const btn  = document.getElementById('btn-toggle-pwd')
  if (!code) return
  if (code.dataset.visible === '1') {
    code.textContent     = '••••••••'
    code.dataset.visible = '0'
    btn.textContent      = '👁 Показать'
  } else {
    code.textContent     = code.dataset.pwd
    code.dataset.visible = '1'
    btn.textContent      = '🙈 Скрыть'
  }
}
window.toggleAnonPwd = toggleAnonPwd

// Запомнить пароль, введённый вручную
function rememberAnonPwd() {
  const input = document.getElementById('anon-pwd-input')
  if (!input || !input.value.trim()) return
  sessionStorage.setItem('anon_pwd_hint', input.value.trim())
  // Перерисовываем профиль — теперь появится кнопка «Показать»
  renderProfile()
}
window.rememberAnonPwd = rememberAnonPwd

async function saveProfile() {
  const alertBox = document.getElementById('profile-alert')

  // Email: у анонима есть отдельное поле p-email-anon, у обычного — disabled (не берём)
  const emailInput = document.getElementById('p-email-anon')
  const emailVal   = emailInput ? emailInput.value.trim() : undefined

  // notify_email: если чекбокс disabled — не трогаем (анонимы без email)
  const notifyEl    = document.getElementById('p-notify')
  const notifyValue = (notifyEl && !notifyEl.disabled) ? notifyEl.checked : undefined

  const body = {
    display_name:      document.getElementById('p-name')?.value.trim() || undefined,
    phone:             document.getElementById('p-phone')?.value.trim() || undefined,
    telegram_username: document.getElementById('p-tg')?.value.trim().replace('@','') || undefined,
    max_profile:       document.getElementById('p-max')?.value.trim() || undefined,
    notify_email:      notifyValue,
    ...(emailVal !== undefined ? { email: emailVal || null } : {}),
  }

  try {
    await API.patch('/user/profile', body)
    showAlert(alertBox, 'success', 'Профиль сохранён ✓')
    // Если аноним указал email — обновляем currentUser для галочки notify_email
    if (emailVal) {
      currentUser = { ...currentUser, email: emailVal }
      // Перерисовываем профиль чтобы галочка стала активной
      await renderProfile()
    }
  } catch (err) {
    showAlert(alertBox, 'error', err.message)
  }
}

// ============================================================
// Чат клиента с консультантом
// ============================================================

let chatPollTimer = null

async function openChat(bookingId, readonly = false) {
  const modal = document.getElementById('modal-root')
  const title = readonly
    ? `📜 История чата — запись #${bookingId}`
    : `💬 Чат с консультантом — запись #${bookingId}`

  const inputBlock = readonly ? `
    <div style="padding:12px 16px;border-top:1px solid var(--c-border);background:#f8f9fa;text-align:center">
      <span style="font-size:13px;color:var(--c-muted)">
        🔒 Запись завершена или отменена — отправка сообщений недоступна
      </span>
    </div>
  ` : `
    <div style="padding:12px 16px;border-top:1px solid var(--c-border);background:#fff">
      <div style="display:flex;gap:8px">
        <textarea id="chat-input" class="form-textarea"
          rows="2" style="margin:0;flex:1;resize:none;font-size:14px"
          placeholder="Напишите сообщение..."
          onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendChatMessage(${bookingId})}">
        </textarea>
        <button class="btn btn-primary" style="align-self:flex-end;white-space:nowrap"
                onclick="sendChatMessage(${bookingId})">
          Отправить
        </button>
      </div>
      <div style="font-size:11px;color:var(--c-muted);margin-top:4px">
        Enter — отправить · Shift+Enter — новая строка
      </div>
    </div>
  `

  modal.innerHTML = `
    <div class="modal-overlay" onclick="closeChat()">
      <div class="modal" onclick="event.stopPropagation()"
           style="max-width:520px;height:80vh;display:flex;flex-direction:column">

        <div class="modal-header">
          <div class="modal-title">${title}</div>
          <button class="modal-close" onclick="closeChat()">✕</button>
        </div>

        <!-- Сообщения -->
        <div id="chat-messages" style="
          flex:1;overflow-y:auto;padding:16px;
          display:flex;flex-direction:column;gap:10px;
          background:#f8f9fa;
        ">
          <div class="loading-overlay"><div class="spinner"></div> Загрузка...</div>
        </div>

        ${inputBlock}

      </div>
    </div>
  `

  await loadChatMessages(bookingId)

  if (!readonly) {
    // Помечаем прочитанными только если чат активен
    try { await API.post(`/chat/${bookingId}/read`) } catch(_) {}
    // Автообновление каждые 8 секунд
    chatPollTimer = setInterval(async () => {
      await loadChatMessages(bookingId, true)
    }, 8000)
  }
}
window.openChat = openChat

async function loadChatMessages(bookingId, silent = false) {
  const container = document.getElementById('chat-messages')
  if (!container) return

  try {
    const { messages } = await API.get(`/chat/${bookingId}`)
    const wasAtBottom = container.scrollHeight - container.scrollTop <= container.clientHeight + 50

    if (messages.length === 0) {
      container.innerHTML = `
        <div style="text-align:center;color:var(--c-muted);padding:40px 20px;font-size:14px">
          Чат пока пуст.<br>Напишите консультанту — он ответит в рабочее время.
        </div>
      `
      return
    }

    container.innerHTML = messages.map(m => {
      // Системные сообщения — отдельный стиль (по центру, серый)
      if (m.sender_type === 'system') {
        return `
          <div style="display:flex;justify-content:center;margin:4px 0">
            <div style="
              max-width:90%;padding:8px 14px;border-radius:10px;
              background:#f0f0f0;color:#666;
              font-size:12px;line-height:1.5;text-align:center;
              border:1px solid #e5e5e5;
              white-space:pre-wrap;word-break:break-word;
            ">${escHtml(m.body)}</div>
          </div>
        `
      }
      const isMe = m.sender_type === 'user'
      const time = new Date(m.created_at).toLocaleTimeString('ru-RU', {
        hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow'
      })
      const date = new Date(m.created_at).toLocaleDateString('ru-RU', {
        day: 'numeric', month: 'short', timeZone: 'Europe/Moscow'
      })
      return `
        <div style="
          display:flex;flex-direction:column;
          align-items:${isMe ? 'flex-end' : 'flex-start'};
          gap:2px
        ">
          <div style="
            max-width:80%;padding:10px 14px;border-radius:${isMe ? '14px 14px 4px 14px' : '14px 14px 14px 4px'};
            background:${isMe ? 'var(--c-primary)' : '#fff'};
            color:${isMe ? '#fff' : 'var(--c-text)'};
            font-size:14px;line-height:1.5;
            box-shadow:0 1px 3px rgba(0,0,0,0.08);
            white-space:pre-wrap;word-break:break-word;
          ">${escHtml(m.body)}</div>
          <div style="font-size:11px;color:var(--c-muted);padding:0 4px">
            ${isMe ? 'Вы' : 'Консультант'} · ${date}, ${time} МСК
          </div>
        </div>
      `
    }).join('')

    // Скролл вниз если были внизу
    if (wasAtBottom || !silent) {
      container.scrollTop = container.scrollHeight
    }
  } catch (err) {
    if (!silent) {
      container.innerHTML = `<div class="alert alert-error">${err.message}</div>`
    }
  }
}

async function sendChatMessage(bookingId) {
  const input = document.getElementById('chat-input')
  if (!input) return
  const text = input.value.trim()
  if (!text) return

  input.value = ''
  input.disabled = true

  try {
    await API.post(`/chat/${bookingId}`, { body: text })
    await loadChatMessages(bookingId, true)
  } catch (err) {
    input.value = text  // вернуть текст при ошибке
    toast(err.message, 'error')
  } finally {
    input.disabled = false
    input.focus()
    const container = document.getElementById('chat-messages')
    if (container) container.scrollTop = container.scrollHeight
  }
}
window.sendChatMessage = sendChatMessage

function closeChat() {
  if (chatPollTimer) { clearInterval(chatPollTimer); chatPollTimer = null }
  document.getElementById('modal-root').innerHTML = ''
}
window.closeChat = closeChat

// ============================================================
// Выбор слота клиентом (если slot_id = NULL при создании записи)
// ============================================================

async function openChooseSlot(bookingId) {
  const modal = document.getElementById('modal-root')
  modal.innerHTML = `
    <div class="modal-overlay" onclick="closeChooseSlot()">
      <div class="modal" onclick="event.stopPropagation()" style="max-width:480px">
        <div class="modal-header">
          <div class="modal-title">📅 Выбрать время встречи</div>
          <button class="modal-close" onclick="closeChooseSlot()">✕</button>
        </div>
        <div class="modal-body">
          <div class="loading-overlay"><div class="spinner"></div> Загружаем расписание...</div>
        </div>
      </div>
    </div>
  `

  try {
    const from = new Date()
    const to   = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    const resp = await API.get(`/slots?consultant_id=1&from=${mskDateStr(from)}&to=${mskDateStr(to)}`)
    const slots = resp.slots || []

    if (slots.length === 0) {
      modal.querySelector('.modal-body').innerHTML = `
        <div class="alert alert-info">
          Свободных слотов пока нет. Напишите консультанту в чате — он предложит время вручную.
        </div>
        <div style="margin-top:12px">
          <button class="btn btn-outline btn-sm" onclick="closeChooseSlot()">Закрыть</button>
        </div>
      `
      return
    }

    // Группируем по дням
    const byDay = {}
    slots.forEach(s => {
      const day = new Date(s.starts_at).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', weekday: 'long', day: 'numeric', month: 'long' })
      if (!byDay[day]) byDay[day] = []
      byDay[day].push(s)
    })

    let selectedSlotId = null

    modal.querySelector('.modal-body').innerHTML = `
      <p style="font-size:13px;color:var(--c-muted);margin-bottom:14px;line-height:1.5">
        Выберите удобное время для встречи с консультантом.
        Все слоты указаны по московскому времени (МСК).
      </p>
      <div id="choose-slot-grid">
        ${Object.entries(byDay).map(([day, daySlots]) => `
          <div style="margin-bottom:16px">
            <div style="font-size:12px;font-weight:600;text-transform:capitalize;
                        color:var(--c-muted);margin-bottom:8px;padding-bottom:4px;
                        border-bottom:1px solid var(--c-border)">${day}</div>
            <div style="display:flex;flex-wrap:wrap;gap:8px">
              ${daySlots.map(s => {
                const time = new Date(s.starts_at).toLocaleTimeString('ru-RU', {
                  hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow'
                })
                return `<button class="time-slot" data-slot-id="${s.id}"
                  onclick="selectChooseSlot(${s.id}, this)">${time}</button>`
              }).join('')}
            </div>
          </div>
        `).join('')}
      </div>
      <div id="choose-slot-alert" style="margin-top:8px"></div>
      <div style="display:flex;gap:8px;margin-top:16px">
        <button class="btn btn-ghost" onclick="closeChooseSlot()">Отмена</button>
        <button class="btn btn-primary" id="btn-confirm-slot" disabled
          onclick="confirmChooseSlot(${bookingId})">
          ✅ Подтвердить время
        </button>
      </div>
    `

    window._chooseSlotId = null
    window.selectChooseSlot = (slotId, btn) => {
      window._chooseSlotId = slotId
      document.querySelectorAll('#choose-slot-grid .time-slot').forEach(el => el.classList.remove('selected'))
      btn.classList.add('selected')
      document.getElementById('btn-confirm-slot').disabled = false
    }

  } catch (err) {
    modal.querySelector('.modal-body').innerHTML = `<div class="alert alert-error">${err.message}</div>`
  }
}
window.openChooseSlot = openChooseSlot

async function confirmChooseSlot(bookingId) {
  const slotId = window._chooseSlotId
  if (!slotId) return
  const btn = document.getElementById('btn-confirm-slot')
  setLoading(btn, true, 'Сохраняем...')
  try {
    await API.post(`/bookings/${bookingId}/choose-slot`, { slot_id: slotId })
    toast('Время выбрано! Консультант получил уведомление. ✅', 'success', 5000)
    closeChooseSlot()
    await renderBookings()
  } catch (err) {
    showAlert(document.getElementById('choose-slot-alert'), 'error', err.message)
    setLoading(btn, false)
  }
}
window.confirmChooseSlot = confirmChooseSlot

function closeChooseSlot() {
  window._chooseSlotId = null
  document.getElementById('modal-root').innerHTML = ''
}
window.closeChooseSlot = closeChooseSlot

function escHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ---- Старт ----
init()
