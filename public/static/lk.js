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
    // Чистим URL
    history.replaceState(null, '', location.pathname)
  }

  navigate('bookings')
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
}

function renderBookingCard(b, isUpcoming) {
  const slot    = b.slot_starts_at ? `📅 ${Fmt.date(b.slot_starts_at)}` : '📅 По договорённости'
  const format  = Fmt.meetingFormat(b.meeting_format)
  const tariff  = b.tariff_name || '—'
  const price   = b.price_rub ? Fmt.money(b.price_rub) : '—'

  // Контакт консультанта (только если оплачено)
  let contactBlock = ''
  if (b.status === 'paid' || b.status === 'in_progress') {
    let contactLinks = []
    if (b.meeting_format === 'telemost' && b.meeting_link) {
      contactLinks.push(`<a href="${b.meeting_link}" target="_blank" class="btn btn-accent btn-sm">📹 Ссылка на TeleМост</a>`)
    } else if ((b.meeting_format === 'telegram' || b.meeting_format === 'max') && b.consultant_telegram) {
      contactLinks.push(`<a href="https://t.me/${b.consultant_telegram}" target="_blank" class="btn btn-outline btn-sm">💬 Написать консультанту</a>`)
    }
    if (contactLinks.length) {
      contactBlock = `<div style="margin:10px 0 0">${contactLinks.join('')}</div>`
    }
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
  const toStr = to.toISOString().split('T')[0]
  const fromStr = from.toISOString().split('T')[0]

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
          <div class="slot-days" id="slot-days">
            ${days.map(d => {
              const firstSlot = byDay[d][0]
              const date = new Date(firstSlot.starts_at)
              return `
                <button class="day-btn ${d === selectedDay ? 'active' : ''}"
                        onclick="selectDay('${d}')">
                  <span class="day-num">${date.getDate()}</span>
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

        ${!user.is_anonymous ? `
          <div class="form-group">
            <label class="form-label">Как к вам обращаться?</label>
            <input class="form-input" id="p-name" value="${user.display_name || ''}" placeholder="Имя или псевдоним">
          </div>
          <div class="form-group">
            <label class="form-label">Email</label>
            <input class="form-input" id="p-email" value="${user.email || ''}" disabled
              style="background:var(--c-bg);color:var(--c-muted)">
            <div class="form-hint">Email изменить нельзя — он используется для входа</div>
          </div>
        ` : `
          <div class="alert alert-info" style="margin-bottom:16px">
            Вы используете анонимный аккаунт. Логин: <strong>${user.login}</strong>
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

        <div class="form-group" style="display:flex;align-items:center;gap:10px">
          <input type="checkbox" id="p-notify" ${user.notify_email ? 'checked' : ''} style="width:16px;height:16px">
          <label for="p-notify" style="font-size:14px;cursor:pointer">
            Получать уведомления на email
          </label>
        </div>

        <button class="btn btn-primary" onclick="saveProfile()">Сохранить</button>
      </div>
    </div>

    ${user.is_anonymous ? `
      <div class="card" style="max-width:520px;margin-top:16px">
        <div class="card-header"><div class="card-title">⚠ Важно для анонимного аккаунта</div></div>
        <div class="card-body">
          <p style="font-size:14px;color:var(--c-muted);line-height:1.6">
            У вас анонимный аккаунт — мы не знаем ваш email или телефон.
            Если вы забудете логин или пароль, восстановить доступ будет <strong>невозможно</strong>.
          </p>
          <div style="margin-top:14px;padding:14px;background:var(--c-bg);border-radius:8px;font-family:monospace;font-size:14px">
            Логин: <strong>${user.login}</strong>
          </div>
          <p style="font-size:12px;color:var(--c-muted);margin-top:8px">
            Сфотографируйте этот экран или сохраните логин в надёжном месте
          </p>
        </div>
      </div>
    ` : ''}
  `
}

async function saveProfile() {
  const alertBox = document.getElementById('profile-alert')
  const body = {
    display_name:      document.getElementById('p-name')?.value.trim() || undefined,
    phone:             document.getElementById('p-phone')?.value.trim() || undefined,
    telegram_username: document.getElementById('p-tg')?.value.trim().replace('@','') || undefined,
    max_profile:       document.getElementById('p-max')?.value.trim() || undefined,
    notify_email:      document.getElementById('p-notify')?.checked,
  }
  try {
    await API.patch('/user/profile', body)
    showAlert(alertBox, 'success', 'Профиль сохранён')
  } catch (err) {
    showAlert(alertBox, 'error', err.message)
  }
}

// ---- Старт ----
init()
