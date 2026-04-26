// ============================================================
// Панель консультанта
// ============================================================

let currentUser = null
let allBookings = []

// ---- Инициализация ----

async function init() {
  currentUser = await Auth.requireConsultant()
  if (!currentUser) return

  document.getElementById('topbar-name').textContent =
    currentUser.display_name || 'Андрей Васильевич'

  $$('[data-page]').forEach(btn => {
    btn.onclick = () => navigate(btn.dataset.page)
  })

  navigate('dashboard')

  // Автообновление каждые 60 сек на странице обзора
  setInterval(() => {
    if (document.querySelector('[data-page="dashboard"].active')) navigate('dashboard')
  }, 60000)
}

async function navigate(page) {
  $$('[data-page]').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.page === page)
  )
  const main = document.getElementById('main')
  main.innerHTML = '<div class="loading-overlay"><div class="spinner"></div> Загрузка...</div>'
  try {
    if (page === 'dashboard') await renderDashboard()
    if (page === 'bookings')  await renderBookings()
    if (page === 'slots')     await renderSlots()
    if (page === 'support')   await renderSupport()
    if (page === 'profile')   await renderProfile()
  } catch (err) {
    main.innerHTML = `<div class="alert alert-error">Ошибка загрузки: ${err.message}</div>`
  }
}

// ============================================================
// Обзор (Dashboard)
// ============================================================

async function renderDashboard() {
  const { stats, upcoming } = await API.get('/consultant/dashboard')
  const main = document.getElementById('main')

  main.innerHTML = `
    <h2 style="margin-bottom:20px">Обзор</h2>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">Ожидают оплаты</div>
        <div class="stat-value" style="color:var(--c-warning)">${stats.pending}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Оплачено / ожидают встречи</div>
        <div class="stat-value" style="color:var(--c-success)">${stats.paid}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Всего записей</div>
        <div class="stat-value">${stats.total}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Выручка (оплачено)</div>
        <div class="stat-value" style="font-size:20px">${Fmt.money(stats.revenue)}</div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <div class="card-title">Ближайшие записи</div>
        <button class="btn btn-ghost btn-sm" onclick="navigate('bookings')">Все записи →</button>
      </div>
      <div class="card-body" style="padding:0">
        ${upcoming.length === 0 ? `
          <div class="empty-state" style="padding:28px">
            <div class="empty-icon">✓</div>
            <p>Нет предстоящих оплаченных записей</p>
          </div>
        ` : upcoming.map(b => renderUpcomingRow(b)).join('')}
      </div>
    </div>
  `

  $$('.btn-booking-detail').forEach(btn => {
    btn.onclick = () => showBookingModal(parseInt(btn.dataset.id))
  })
}

function renderUpcomingRow(b) {
  const clientContact = buildClientContact(b)
  const slot = b.starts_at ? Fmt.date(b.starts_at) : 'Время не выбрано'

  return `
    <div style="padding:14px 18px;border-bottom:1px solid var(--c-border);display:flex;align-items:center;gap:14px">
      <div style="flex:1">
        <div style="font-weight:600;font-size:14px">${b.tariff_name}</div>
        <div style="font-size:13px;color:var(--c-muted)">📅 ${slot} · ${Fmt.meetingFormat(b.meeting_format)}</div>
        ${b.client_name ? `<div style="font-size:13px;color:var(--c-muted)">👤 ${b.client_name}</div>` : ''}
      </div>
      ${clientContact ? `<div class="client-contact-row" style="flex-shrink:0">${clientContact}</div>` : ''}
      <button class="btn btn-outline btn-sm btn-booking-detail" data-id="${b.id}">Открыть</button>
    </div>
  `
}

function buildClientContact(b) {
  if (b.meeting_format === 'telegram' && b.telegram_username) {
    return `💬 <a href="https://t.me/${b.telegram_username}" target="_blank">@${b.telegram_username}</a>`
  }
  if (b.meeting_format === 'max' && b.max_profile) {
    return `💬 <a href="${b.max_profile}" target="_blank">Макс</a>`
  }
  if (b.client_contact) return `📞 ${b.client_contact}`
  return ''
}

// ============================================================
// Все записи
// ============================================================

async function renderBookings() {
  const main = document.getElementById('main')
  const statusFilter = ['', 'paid', 'pending_payment', 'completed', 'cancelled']
  let activeFilter = ''

  async function load() {
    const url = activeFilter ? `/bookings/consultant/list?status=${activeFilter}` : '/bookings/consultant/list'
    const { bookings } = await API.get(url)
    allBookings = bookings

    const listEl = document.getElementById('bookings-list')
    if (!listEl) return

    if (bookings.length === 0) {
      listEl.innerHTML = '<div class="empty-state" style="padding:32px"><p>Нет записей</p></div>'
      return
    }

    listEl.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Услуга</th>
              <th>Время</th>
              <th>Статус</th>
              <th>Формат</th>
              <th>Клиент</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${bookings.map(b => `
              <tr>
                <td style="color:var(--c-muted);font-size:13px">#${b.id}</td>
                <td style="font-weight:500">${b.tariff_name}</td>
                <td style="font-size:13px">${b.slot_starts_at ? Fmt.dateShort(b.slot_starts_at) : '—'}</td>
                <td>${Fmt.statusBadge(b.status)}</td>
                <td style="font-size:13px">${Fmt.meetingFormat(b.meeting_format)}</td>
                <td style="font-size:13px">${b.client_name || b.client_email || '—'}</td>
                <td>
                  <button class="btn btn-ghost btn-sm btn-detail" data-id="${b.id}">Открыть</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `
    $$('.btn-detail', listEl).forEach(btn =>
      btn.onclick = () => showBookingModal(parseInt(btn.dataset.id))
    )
  }

  main.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
      <h2>Записи</h2>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn btn-sm ${activeFilter===''?'btn-primary':'btn-outline'}" onclick="filterBookings('')">Все</button>
        <button class="btn btn-sm ${activeFilter==='paid'?'btn-primary':'btn-outline'}" onclick="filterBookings('paid')">Оплачено</button>
        <button class="btn btn-sm ${activeFilter==='pending_payment'?'btn-primary':'btn-outline'}" onclick="filterBookings('pending_payment')">Ожидает оплаты</button>
        <button class="btn btn-sm ${activeFilter==='completed'?'btn-primary':'btn-outline'}" onclick="filterBookings('completed')">Завершено</button>
      </div>
    </div>
    <div class="card">
      <div id="bookings-list"><div class="loading-overlay"><div class="spinner"></div></div></div>
    </div>
  `

  window.filterBookings = async (status) => {
    activeFilter = status
    $$('[onclick^="filterBookings"]').forEach(btn => {
      const s = btn.getAttribute('onclick').match(/'([^']*)'/)
      btn.className = `btn btn-sm ${s && s[1] === status ? 'btn-primary' : 'btn-outline'}`
    })
    await load()
  }

  await load()
}

// ---- Детальная карточка записи (модалка) ----

async function showBookingModal(bookingId) {
  const { booking: b } = await API.get(`/bookings/${bookingId}`)

  const clientContact = buildClientContact({
    meeting_format: b.meeting_format,
    telegram_username: b.telegram_username || (b.client_contact || '').replace('@', ''),
    max_profile: b.max_profile,
    client_contact: b.client_contact
  })

  const modal = document.createElement('div')
  modal.className = 'modal-backdrop'
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <div class="modal-title">Запись #${b.id} — ${b.tariff_name}</div>
        <button class="modal-close" onclick="this.closest('.modal-backdrop').remove()">✕</button>
      </div>
      <div class="modal-body">

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px">
          <div>
            <div class="form-label">Статус</div>
            <div>${Fmt.statusBadge(b.status)}</div>
          </div>
          <div>
            <div class="form-label">Стоимость</div>
            <div style="font-weight:600">${Fmt.money(b.price_rub)}</div>
          </div>
          <div>
            <div class="form-label">Время встречи</div>
            <div style="font-size:14px">${b.slot_starts_at ? Fmt.date(b.slot_starts_at) : '—'}</div>
          </div>
          <div>
            <div class="form-label">Формат</div>
            <div style="font-size:14px">${Fmt.meetingFormat(b.meeting_format)}</div>
          </div>
          ${b.paid_at ? `
          <div>
            <div class="form-label">Оплачено</div>
            <div style="font-size:14px">${Fmt.date(b.paid_at)}</div>
          </div>` : ''}
        </div>

        ${clientContact ? `
          <div class="client-contact-row" style="margin-bottom:14px">
            <strong>Контакт клиента:</strong>&nbsp;${clientContact}
          </div>
        ` : ''}

        ${b.client_question ? `
          <div style="margin-bottom:16px">
            <div class="form-label">Вопрос клиента</div>
            <div style="background:var(--c-bg);padding:12px 14px;border-radius:8px;font-size:14px;line-height:1.6">
              ${b.client_question}
            </div>
          </div>
        ` : ''}

        <!-- Ссылка на встречу (TeleМост) -->
        ${b.meeting_format === 'telemost' ? `
          <div class="form-group">
            <label class="form-label">Ссылка на TeleМост (заполните и отправьте клиенту)</label>
            <div style="display:flex;gap:8px">
              <input class="form-input" id="meeting-link-input" value="${b.meeting_link || ''}"
                placeholder="https://telemost.yandex.ru/j/...">
              <button class="btn btn-primary btn-sm" onclick="saveMeetingLink(${b.id})">Сохранить</button>
            </div>
          </div>
        ` : ''}

        <!-- Статус встречи -->
        <div class="form-group">
          <label class="form-label">Обновить статус</label>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            ${b.status === 'paid' ? `
              <button class="btn btn-outline btn-sm" onclick="updateBookingStatus(${b.id},'in_progress')">▶ Встреча идёт</button>
              <button class="btn btn-outline btn-sm" onclick="updateBookingStatus(${b.id},'completed')">✓ Завершить</button>
            ` : ''}
            ${b.status === 'in_progress' ? `
              <button class="btn btn-outline btn-sm" onclick="updateBookingStatus(${b.id},'completed')">✓ Завершить</button>
            ` : ''}
          </div>
        </div>

        <!-- Заметки -->
        <div class="form-group">
          <label class="form-label">Мои заметки (приватные, клиент не видит)</label>
          <textarea class="form-textarea" id="notes-input" rows="3">${b.consultant_notes || ''}</textarea>
          <button class="btn btn-ghost btn-sm" style="margin-top:6px" onclick="saveNotes(${b.id})">Сохранить заметки</button>
        </div>

        <div id="modal-alert"></div>
      </div>

      <div class="modal-footer">
        <button class="btn btn-outline" onclick="this.closest('.modal-backdrop').remove()">Закрыть</button>
        ${(b.status === 'paid' || b.status === 'completed') ? `
          <button class="btn btn-primary" onclick="offerSupport(${b.user_id})">🤝 Предложить сопровождение</button>
        ` : ''}
      </div>
    </div>
  `

  document.getElementById('modal-root').appendChild(modal)
  modal.onclick = e => { if (e.target === modal) modal.remove() }
}

async function saveMeetingLink(bookingId) {
  const link = document.getElementById('meeting-link-input').value.trim()
  try {
    await API.patch(`/bookings/${bookingId}`, { meeting_link: link })
    toast('Ссылка сохранена', 'success')
  } catch (err) { toast(err.message, 'error') }
}

async function updateBookingStatus(bookingId, status) {
  try {
    await API.patch(`/bookings/${bookingId}`, { status })
    toast('Статус обновлён', 'success')
    document.querySelector('.modal-backdrop')?.remove()
    navigate('bookings')
  } catch (err) { toast(err.message, 'error') }
}

async function saveNotes(bookingId) {
  const notes = document.getElementById('notes-input').value
  try {
    await API.patch(`/bookings/${bookingId}`, { consultant_notes: notes })
    toast('Заметки сохранены', 'success')
  } catch (err) { toast(err.message, 'error') }
}

// ============================================================
// Расписание / слоты
// ============================================================

async function renderSlots() {
  const main = document.getElementById('main')

  // Загружаем слоты на ближайшие 4 недели
  const from = new Date()
  const to   = new Date(Date.now() + 28 * 24 * 60 * 60 * 1000)
  const { slots } = await API.get(
    `/slots?consultant_id=1&from=${from.toISOString().split('T')[0]}&to=${to.toISOString().split('T')[0]}`
  )

  // Также загружаем все бронирования со слотами
  const { bookings } = await API.get('/bookings/consultant/list?status=paid')
  const bookedSlotIds = new Set(bookings.filter(b => b.slot_id).map(b => b.slot_id))

  main.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;gap:12px;flex-wrap:wrap">
      <h2>Расписание</h2>
      <button class="btn btn-primary" onclick="showAddSlotModal()">+ Добавить слот</button>
    </div>

    <div class="card" style="margin-bottom:20px">
      <div class="card-header"><div class="card-title">Быстрое добавление — неделя слотов</div></div>
      <div class="card-body">
        <p style="font-size:14px;color:var(--c-muted);margin-bottom:14px">
          Выберите дни и время — добавим слоты на ближайшие 4 недели
        </p>
        <div id="quick-slot-ui">
          <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px">
            ${['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map((d,i) => `
              <label style="display:flex;align-items:center;gap:5px;cursor:pointer">
                <input type="checkbox" class="day-check" value="${i}" ${i<5?'checked':''}>
                <span style="font-size:14px">${d}</span>
              </label>
            `).join('')}
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px">
            ${['09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00','19:00','20:00'].map(t => `
              <label style="display:flex;align-items:center;gap:5px;cursor:pointer">
                <input type="checkbox" class="time-check" value="${t}">
                <span style="font-size:14px">${t}</span>
              </label>
            `).join('')}
          </div>
          <div id="quick-alert"></div>
          <button class="btn btn-primary btn-sm" onclick="addWeeklySlots()">Создать слоты</button>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <div class="card-title">Существующие слоты (${slots.length})</div>
      </div>
      <div class="card-body" style="padding:0">
        ${slots.length === 0 ? `
          <div class="empty-state" style="padding:32px">
            <div class="empty-icon">🗓</div>
            <p>Слотов пока нет</p>
            <div class="empty-hint">Добавьте доступное время для встреч</div>
          </div>
        ` : `
          <div class="table-wrap">
            <table>
              <thead><tr><th>Дата и время</th><th>Длительность</th><th>Статус</th><th></th></tr></thead>
              <tbody>
                ${slots.map(s => {
                  const isBooked = bookedSlotIds.has(s.id)
                  const duration = Math.round((new Date(s.ends_at) - new Date(s.starts_at)) / 60000)
                  return `
                    <tr>
                      <td style="font-weight:500">${Fmt.date(s.starts_at)}</td>
                      <td style="font-size:13px;color:var(--c-muted)">${duration} мин</td>
                      <td>${isBooked
                        ? '<span class="badge badge-paid">Занят</span>'
                        : '<span class="badge badge-info">Свободен</span>'
                      }</td>
                      <td>
                        ${!isBooked ? `
                          <button class="btn btn-danger btn-sm" onclick="deleteSlot(${s.id})">Удалить</button>
                        ` : ''}
                      </td>
                    </tr>
                  `
                }).join('')}
              </tbody>
            </table>
          </div>
        `}
      </div>
    </div>
  `
}

async function addWeeklySlots() {
  const checkedDays  = [...document.querySelectorAll('.day-check:checked')].map(el => parseInt(el.value))
  const checkedTimes = [...document.querySelectorAll('.time-check:checked')].map(el => el.value)
  const alertBox     = document.getElementById('quick-alert')

  if (!checkedDays.length)  { showAlert(alertBox, 'error', 'Выберите хотя бы один день'); return }
  if (!checkedTimes.length) { showAlert(alertBox, 'error', 'Выберите хотя бы одно время'); return }

  // Генерируем слоты на 4 недели вперёд
  const slots = []
  const now = new Date()

  for (let week = 0; week < 4; week++) {
    for (const dayOfWeek of checkedDays) {
      for (const time of checkedTimes) {
        // Находим ближайшую дату с нужным днём недели
        const d = new Date(now)
        d.setDate(d.getDate() + ((dayOfWeek + 7 - d.getDay()) % 7) + week * 7)
        const [h, m] = time.split(':').map(Number)
        d.setHours(h, m, 0, 0)

        // Пропускаем прошедшее
        if (d <= now) continue

        const ends = new Date(d.getTime() + 60 * 60 * 1000) // +1 час
        slots.push({
          starts_at: d.toISOString(),
          ends_at:   ends.toISOString()
        })
      }
    }
  }

  if (!slots.length) { showAlert(alertBox, 'error', 'Все выбранные дни уже прошли'); return }

  try {
    const { created } = await API.post('/slots/batch', { consultant_id: 1, slots })
    toast(`Создано ${created} слотов`, 'success')
    await renderSlots()
  } catch (err) {
    showAlert(alertBox, 'error', err.message)
  }
}

async function deleteSlot(id) {
  if (!confirm('Удалить этот слот?')) return
  try {
    await API.delete(`/slots/${id}`)
    toast('Слот удалён', 'info')
    await renderSlots()
  } catch (err) {
    toast(err.message, 'error')
  }
}

function showAddSlotModal() {
  const now = new Date()
  const dateStr = now.toISOString().slice(0, 16)

  const modal = document.createElement('div')
  modal.className = 'modal-backdrop'
  modal.innerHTML = `
    <div class="modal" style="max-width:400px">
      <div class="modal-header">
        <div class="modal-title">Добавить слот</div>
        <button class="modal-close" onclick="this.closest('.modal-backdrop').remove()">✕</button>
      </div>
      <div class="modal-body">
        <div id="add-slot-alert"></div>
        <div class="form-group">
          <label class="form-label">Начало</label>
          <input class="form-input" id="slot-start" type="datetime-local" value="${dateStr}">
        </div>
        <div class="form-group">
          <label class="form-label">Длительность</label>
          <select class="form-select" id="slot-dur">
            <option value="60">60 минут</option>
            <option value="90">90 минут</option>
            <option value="30">30 минут</option>
          </select>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="this.closest('.modal-backdrop').remove()">Отмена</button>
        <button class="btn btn-primary" onclick="addSingleSlot()">Добавить</button>
      </div>
    </div>
  `
  document.getElementById('modal-root').appendChild(modal)
  modal.onclick = e => { if (e.target === modal) modal.remove() }
}

async function addSingleSlot() {
  const start = document.getElementById('slot-start').value
  const dur   = parseInt(document.getElementById('slot-dur').value)
  const alertBox = document.getElementById('add-slot-alert')

  if (!start) { showAlert(alertBox, 'error', 'Укажите начало'); return }

  const startDate = new Date(start)
  const endDate   = new Date(startDate.getTime() + dur * 60000)

  try {
    await API.post('/slots', {
      consultant_id: 1,
      starts_at: startDate.toISOString(),
      ends_at:   endDate.toISOString()
    })
    toast('Слот добавлен', 'success')
    document.querySelector('.modal-backdrop')?.remove()
    await renderSlots()
  } catch (err) {
    showAlert(alertBox, 'error', err.message)
  }
}

// ============================================================
// Сопровождение — предложить клиенту
// ============================================================

async function renderSupport() {
  const { tariffs } = await API.get('/tariffs')
  const supportTariffs = tariffs.filter(t => t.is_support)
  const main = document.getElementById('main')

  main.innerHTML = `
    <h2 style="margin-bottom:20px">Сопровождение</h2>

    <div class="card" style="max-width:540px">
      <div class="card-header"><div class="card-title">Предложить сопровождение клиенту</div></div>
      <div class="card-body">
        <p style="font-size:14px;color:var(--c-muted);margin-bottom:16px">
          После отправки клиент увидит предложение в своём кабинете и сможет его оплатить.
        </p>
        <div id="support-alert"></div>
        <div class="form-group">
          <label class="form-label">ID клиента (из карточки записи)</label>
          <input class="form-input" id="s-user-id" type="number" placeholder="Например: 3">
        </div>
        <div class="form-group">
          <label class="form-label">Тариф</label>
          <select class="form-select" id="s-tariff">
            ${supportTariffs.map(t => `<option value="${t.id}">${t.name} — ${Fmt.money(t.price_rub)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Индивидуальная цена <span style="font-weight:400;color:var(--c-muted)">(если отличается от стандартной)</span></label>
          <input class="form-input" id="s-price" type="number" placeholder="Оставьте пустым для стандартной цены">
        </div>
        <div class="form-group">
          <label class="form-label">Комментарий для клиента</label>
          <textarea class="form-textarea" id="s-comment" rows="3"
            placeholder="Что обсудили, почему рекомендую..."></textarea>
        </div>
        <button class="btn btn-primary" onclick="offerSupport()">Отправить предложение</button>
      </div>
    </div>
  `

  window.offerSupport = async (userId) => {
    const userIdEl = document.getElementById('s-user-id')
    const uid = userId || parseInt(userIdEl?.value)
    const tariffId = parseInt(document.getElementById('s-tariff').value)
    const price    = document.getElementById('s-price').value
    const comment  = document.getElementById('s-comment').value.trim()
    const alertBox = document.getElementById('support-alert')

    if (!uid)    { showAlert(alertBox, 'error', 'Укажите ID клиента'); return }
    if (!tariffId) { showAlert(alertBox, 'error', 'Выберите тариф'); return }

    if (userId) document.getElementById('s-user-id').value = userId

    try {
      await API.post('/consultant/support-offer', {
        user_id: uid,
        tariff_id: tariffId,
        custom_price_rub: price ? parseInt(price) : undefined,
        consultant_comment: comment || undefined
      })
      showAlert(alertBox, 'success', 'Предложение отправлено — клиент увидит его в своём кабинете')
    } catch (err) {
      showAlert(alertBox, 'error', err.message)
    }
  }
}

// ============================================================
// Профиль консультанта
// ============================================================

async function renderProfile() {
  const { profile } = await API.get('/consultant/profile')
  const main = document.getElementById('main')

  main.innerHTML = `
    <h2 style="margin-bottom:24px">Настройки профиля</h2>

    <div class="card" style="max-width:560px">
      <div class="card-header"><div class="card-title">Публичный профиль</div></div>
      <div class="card-body">
        <div id="profile-alert"></div>
        <div class="form-group">
          <label class="form-label">Должность / специализация</label>
          <input class="form-input" id="p-title" value="${profile?.title || ''}">
        </div>
        <div class="form-group">
          <label class="form-label">Короткое bio (для карточки на сайте)</label>
          <textarea class="form-textarea" id="p-bio-short" rows="2">${profile?.bio_short || ''}</textarea>
        </div>
        <div class="form-group">
          <label class="form-label">Полное bio</label>
          <textarea class="form-textarea" id="p-bio-full" rows="5">${profile?.bio_full || ''}</textarea>
        </div>

        <div style="margin:16px 0 8px;font-size:13px;font-weight:600;text-transform:uppercase;color:var(--c-muted)">Контакты (не видны клиентам)</div>
        <div class="form-group">
          <label class="form-label">Email для уведомлений</label>
          <input class="form-input" id="p-email" value="${profile?.email || ''}" placeholder="andrey@example.com">
        </div>
        <div class="form-group">
          <label class="form-label">Telegram Chat ID (для уведомлений о новых записях)</label>
          <input class="form-input" id="p-tg" value="${profile?.telegram_chat_id || ''}" placeholder="123456789">
          <div class="form-hint">Узнать свой chat_id можно через @userinfobot в Telegram</div>
        </div>

        <div style="margin:16px 0 8px;font-size:13px;font-weight:600;text-transform:uppercase;color:var(--c-muted)">Форматы встреч</div>
        <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:16px">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
            <input type="checkbox" id="p-telemost" ${profile?.supports_telemost ? 'checked' : ''}>
            <span>📹 TeleМост (видеозвонок)</span>
          </label>
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
            <input type="checkbox" id="p-telegram" ${profile?.supports_telegram ? 'checked' : ''}>
            <span>💬 Telegram / Макс</span>
          </label>
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
            <input type="checkbox" id="p-phone" ${profile?.supports_phone ? 'checked' : ''}>
            <span>📞 Телефонный звонок</span>
          </label>
        </div>

        <button class="btn btn-primary" onclick="saveProfile()">Сохранить</button>
      </div>
    </div>
  `
}

async function saveProfile() {
  const alertBox = document.getElementById('profile-alert')
  try {
    await API.patch('/consultant/profile', {
      title:             document.getElementById('p-title').value.trim(),
      bio_short:         document.getElementById('p-bio-short').value.trim(),
      bio_full:          document.getElementById('p-bio-full').value.trim(),
      email:             document.getElementById('p-email').value.trim(),
      telegram_chat_id:  document.getElementById('p-tg').value.trim(),
      supports_telemost: document.getElementById('p-telemost').checked,
      supports_telegram: document.getElementById('p-telegram').checked,
      supports_phone:    document.getElementById('p-phone').checked,
    })
    showAlert(alertBox, 'success', 'Профиль сохранён')
  } catch (err) {
    showAlert(alertBox, 'error', err.message)
  }
}

// ---- Старт ----
init()
