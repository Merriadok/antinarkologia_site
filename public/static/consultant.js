// ============================================================
// Панель консультанта — АНТИНаркология
// ============================================================

let currentUser = null
let currentPage = 'dashboard'
let consultantProfile = null  // кэш профиля (включает timezone)

// Возвращает timezone из профиля или дефолтный МСК
function getConsultantTZ() {
  return (consultantProfile && consultantProfile.timezone) || 'Europe/Moscow'
}

// Смещение в часах для заданного timezone (приближённо через Intl)
function tzOffsetHours(tz) {
  const now = new Date()
  // Разница между UTC и local в этом TZ
  const utcStr = now.toLocaleString('en-US', { timeZone: 'UTC' })
  const tzStr  = now.toLocaleString('en-US', { timeZone: tz })
  return (new Date(tzStr) - new Date(utcStr)) / 3_600_000
}

// ---- Инициализация ----

async function init() {
  currentUser = await Auth.requireConsultant()
  if (!currentUser) return

  document.getElementById('topbar-name').textContent =
    currentUser.display_name || 'Консультант'

  // Загружаем профиль (в т.ч. timezone) сразу при старте
  try {
    const { profile } = await API.get('/consultant/profile')
    consultantProfile = profile || {}
  } catch {}

  // Навигация
  $$('[data-page]', document.getElementById('sidebar')).forEach(btn => {
    btn.onclick = () => navigate(btn.dataset.page)
  })

  navigate('dashboard')
}

async function navigate(page) {
  currentPage = page
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
    console.error(err)
  }
}

// ============================================================
// 📊 Обзор / Дашборд
// ============================================================

async function renderDashboard() {
  const main = document.getElementById('main')

  const { stats, upcoming } = await API.get('/consultant/dashboard')

  const statCards = [
    { label: 'Ожидают оплаты', value: stats.pending,  icon: '⏳', color: '#f59e0b' },
    { label: 'Оплачено',       value: stats.paid,     icon: '✓',  color: '#10b981' },
    { label: 'Всего записей',  value: stats.total,    icon: '📋', color: '#6366f1' },
    { label: 'Выручка',        value: Fmt.money(stats.revenue), icon: '₽', color: '#3b82f6', raw: true },
  ]

  main.innerHTML = `
    <h2 style="margin-bottom:20px">Обзор</h2>

    <!-- Карточки статистики -->
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:28px">
      ${statCards.map(s => `
        <div class="card" style="border-left:4px solid ${s.color}">
          <div class="card-body" style="padding:14px 16px">
            <div style="font-size:24px;font-weight:700;color:${s.color}">
              ${s.raw ? s.value : s.value}
            </div>
            <div style="font-size:13px;color:var(--c-muted);margin-top:4px">${s.icon} ${s.label}</div>
          </div>
        </div>
      `).join('')}
    </div>

    <!-- Ближайшие встречи -->
    <h3 style="font-size:14px;font-weight:700;margin-bottom:14px;text-transform:uppercase;letter-spacing:.06em;color:var(--c-muted)">
      Ближайшие оплаченные записи
    </h3>

    ${upcoming.length === 0 ? `
      <div class="empty-state">
        <div class="empty-icon">📅</div>
        <p>Нет предстоящих встреч</p>
        <div class="empty-hint">Оплаченные записи появятся здесь</div>
      </div>
    ` : upcoming.map(b => renderUpcomingCard(b)).join('')}
  `

  // Обработчики кнопок
  $$('.btn-open-booking').forEach(btn => {
    btn.onclick = () => openBookingModal(btn.dataset.id)
  })
}

function renderUpcomingCard(b) {
  const clientName = b.client_name || 'Анонимный клиент'
  const slotDate   = b.starts_at ? Fmt.date(b.starts_at) : '🕒 Время не согласовано'
  const format     = Fmt.meetingFormat(b.meeting_format)

  // Контакты клиента
  let contacts = []
  if (b.client_email) contacts.push(`📧 ${b.client_email}`)
  if (b.telegram_username) contacts.push(`✈️ @${b.telegram_username}`)
  if (b.max_profile) contacts.push(`💬 Макс`)

  return `
    <div class="booking-card" style="margin-bottom:12px">
      <div class="booking-header">
        <div>
          <div class="booking-title">${clientName}</div>
          <div class="booking-date">${slotDate}</div>
        </div>
        ${Fmt.statusBadge(b.status)}
      </div>
      <div class="booking-meta">
        <span class="booking-meta-item">${b.tariff_name || '—'}</span>
        <span class="booking-meta-item">· ${format}</span>
        ${contacts.length ? `<span class="booking-meta-item">· ${contacts[0]}</span>` : ''}
      </div>
      ${b.client_question ? `
        <div style="font-size:13px;color:var(--c-muted);font-style:italic;margin-top:4px;
                    padding:8px 12px;background:var(--c-bg);border-radius:6px">
          "${b.client_question}"
        </div>
      ` : ''}
      <div class="booking-actions" style="margin-top:10px">
        <button class="btn btn-outline btn-sm btn-open-booking" data-id="${b.id}">
          📝 Детали / Ссылка
        </button>
      </div>
    </div>
  `
}

// ============================================================
// 📋 Все записи
// ============================================================

let bookingFilter = 'all'

async function renderBookings() {
  const main = document.getElementById('main')

  const statusOptions = [
    { value: 'all',             label: 'Все' },
    { value: 'pending_payment', label: '⏳ Ожидают оплаты' },
    { value: 'paid',            label: '✓ Оплачено' },
    { value: 'completed',       label: '✔ Завершённые' },
    { value: 'cancelled',       label: '✕ Отменённые' },
  ]

  main.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;flex-wrap:wrap;gap:10px">
      <h2>Все записи</h2>
      <div style="display:flex;gap:6px;flex-wrap:wrap" id="filter-tabs">
        ${statusOptions.map(o => `
          <button class="btn btn-sm ${bookingFilter === o.value ? 'btn-primary' : 'btn-outline'}"
                  onclick="setBookingFilter('${o.value}')">
            ${o.label}
          </button>
        `).join('')}
      </div>
    </div>
    <div id="bookings-list">
      <div class="loading-overlay"><div class="spinner"></div> Загружаем...</div>
    </div>
  `

  await loadBookingsList()
}

window.setBookingFilter = async (status) => {
  bookingFilter = status
  // Перерисовать кнопки фильтра
  const statusOptions = [
    { value: 'all',             label: 'Все' },
    { value: 'pending_payment', label: '⏳ Ожидают оплаты' },
    { value: 'paid',            label: '✓ Оплачено' },
    { value: 'completed',       label: '✔ Завершённые' },
    { value: 'cancelled',       label: '✕ Отменённые' },
  ]
  document.getElementById('filter-tabs').innerHTML = statusOptions.map(o => `
    <button class="btn btn-sm ${bookingFilter === o.value ? 'btn-primary' : 'btn-outline'}"
            onclick="setBookingFilter('${o.value}')">
      ${o.label}
    </button>
  `).join('')
  await loadBookingsList()
}

async function loadBookingsList() {
  const container = document.getElementById('bookings-list')
  if (!container) return

  const query = bookingFilter !== 'all' ? `?status=${bookingFilter}` : ''
  const { bookings } = await API.get(`/bookings/consultant/list${query}`)

  if (bookings.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📋</div>
        <p>Записей не найдено</p>
      </div>
    `
    return
  }

  container.innerHTML = `
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Клиент</th>
            <th>Тариф</th>
            <th>Дата</th>
            <th>Формат</th>
            <th>Статус</th>
            <th>Действия</th>
          </tr>
        </thead>
        <tbody>
          ${bookings.map(b => {
            const clientName = b.client_name || (b.client_email ? b.client_email.split('@')[0] : `ID ${b.user_id}`)
            const slotDate   = b.slot_starts_at ? Fmt.dateShort(b.slot_starts_at) : '—'
            return `
              <tr>
                <td style="color:var(--c-muted);font-size:12px">#${b.id}</td>
                <td>
                  <div style="font-weight:500">${clientName}</div>
                  ${b.client_email ? `<div style="font-size:11px;color:var(--c-muted)">${b.client_email}</div>` : ''}
                </td>
                <td style="font-size:13px">${b.tariff_name || '—'}</td>
                <td style="font-size:13px;white-space:nowrap">${slotDate}</td>
                <td style="font-size:13px">${Fmt.meetingFormat(b.meeting_format)}</td>
                <td>${Fmt.statusBadge(b.status)}</td>
                <td>
                  <button class="btn btn-outline btn-sm btn-open-booking" data-id="${b.id}">
                    Детали
                  </button>
                </td>
              </tr>
            `
          }).join('')}
        </tbody>
      </table>
    </div>
  `

  $$('.btn-open-booking').forEach(btn => {
    btn.onclick = () => openBookingModal(btn.dataset.id)
  })
}

// ============================================================
// Модалка детали записи
// ============================================================

async function openBookingModal(bookingId) {
  // Получаем полную запись
  let booking
  try {
    const resp = await API.get(`/bookings/${bookingId}`)
    booking = resp.booking
  } catch (err) {
    toast(err.message, 'error')
    return
  }

  const clientName = booking.client_name || 'Анонимный клиент'

  // Формируем контактный блок клиента
  let contactsHtml = ''
  if (booking.client_email) contactsHtml += `<div>📧 <a href="mailto:${booking.client_email}">${booking.client_email}</a></div>`
  if (booking.telegram_username) contactsHtml += `<div>✈️ <a href="https://t.me/${booking.telegram_username}" target="_blank">@${booking.telegram_username}</a></div>`
  if (booking.max_profile) contactsHtml += `<div>💬 <a href="${booking.max_profile}" target="_blank">Макс</a></div>`
  if (booking.client_contact) contactsHtml += `<div>📱 ${booking.client_contact}</div>`

  const modal = document.getElementById('modal-root')
  modal.innerHTML = `
    <div class="modal-overlay" onclick="closeModal()">
      <div class="modal" onclick="event.stopPropagation()" style="max-width:560px">

        <div class="modal-header">
          <div class="modal-title">Запись #${booking.id} — ${clientName}</div>
          <button class="modal-close" onclick="closeModal()">✕</button>
        </div>

        <div class="modal-body">

          <!-- Статус + тариф -->
          <div style="display:flex;gap:8px;align-items:center;margin-bottom:16px;flex-wrap:wrap">
            ${Fmt.statusBadge(booking.status)}
            <span style="font-weight:600">${booking.tariff_name || '—'}</span>
            <span style="color:var(--c-muted)">·</span>
            <span style="font-size:14px;color:var(--c-muted)">${Fmt.meetingFormat(booking.meeting_format)}</span>
          </div>

          <!-- Дата встречи / предложение времени -->
          <div class="form-group">
            <label class="form-label">📅 Дата встречи</label>
            ${booking.slot_starts_at ? `
              <div class="form-input" style="background:var(--c-bg);color:var(--c-muted);cursor:default">
                ${Fmt.date(booking.slot_starts_at)}
              </div>
            ` : booking.proposed_time && booking.proposed_time_status === 'pending' ? `
              <div style="padding:10px 12px;background:#fffbeb;border:1px solid #f59e0b;border-radius:6px;font-size:14px">
                ⏳ Ожидает подтверждения клиентом: <strong>${Fmt.date(booking.proposed_time)}</strong>
              </div>
            ` : booking.proposed_time && booking.proposed_time_status === 'accepted' ? `
              <div style="padding:10px 12px;background:#f0fdf4;border:1px solid #22c55e;border-radius:6px;font-size:14px">
                ✅ Клиент подтвердил: <strong>${Fmt.date(booking.proposed_time)}</strong>
              </div>
            ` : booking.proposed_time && booking.proposed_time_status === 'declined' ? `
              <div style="padding:10px 12px;background:#fef2f2;border:1px solid #ef4444;border-radius:6px;font-size:14px;margin-bottom:8px">
                ❌ Клиент отклонил предложение: ${Fmt.date(booking.proposed_time)}
              </div>
            ` : `
              <div class="form-input" style="background:var(--c-bg);color:var(--c-muted);cursor:default">
                Не выбрана
              </div>
            `}
          </div>

          <!-- Предложить время клиенту (только если нет слота и нет pending-предложения) -->
          ${!booking.slot_starts_at && booking.proposed_time_status !== 'pending' && ['paid','pending_payment'].includes(booking.status) ? `
            <div class="form-group" style="padding:14px 16px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px">
              <label class="form-label" style="color:#0369a1">🕐 Предложить время клиенту</label>
              <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap">
                <div style="flex:1;min-width:200px">
                  <input class="form-input" type="datetime-local" id="modal-propose-time"
                    min="${new Date().toISOString().slice(0,16)}"
                    style="font-size:14px">
                </div>
                <button class="btn btn-primary btn-sm" onclick="proposeBookingTime(${booking.id})"
                        style="white-space:nowrap">
                  📨 Отправить предложение
                </button>
              </div>
              <div class="form-hint" style="margin-top:6px">
                Клиент получит уведомление и сможет подтвердить или отклонить время в своём ЛК
              </div>
            </div>
          ` : ''}

          <!-- Контакты клиента -->
          ${contactsHtml ? `
            <div class="form-group">
              <label class="form-label">Контакты клиента</label>
              <div style="font-size:14px;line-height:1.8">${contactsHtml}</div>
            </div>
          ` : ''}

          <!-- Вопрос клиента -->
          ${booking.client_question ? `
            <div class="form-group">
              <label class="form-label">Вопрос / ситуация</label>
              <div style="font-size:14px;padding:10px 12px;background:var(--c-bg);border-radius:6px;
                          border:1px solid var(--c-border);font-style:italic;line-height:1.6">
                "${booking.client_question}"
              </div>
            </div>
          ` : ''}

          <!-- Ссылка на встречу (TeleМост) -->
          <div class="form-group">
            <label class="form-label">🔗 Ссылка на встречу (TeleМост / другое)</label>
            <div style="display:flex;gap:8px;margin-bottom:8px">
              <input class="form-input" id="modal-link" type="url"
                placeholder="https://telemost.yandex.ru/..."
                value="${booking.meeting_link || ''}">
              <button class="btn btn-primary" onclick="saveBookingLink(${booking.id})" style="white-space:nowrap">
                Сохранить
              </button>
            </div>
            ${booking.meeting_format === 'telemost' ? `
              <button class="btn btn-outline btn-sm" onclick="autoCreateTelemost(${booking.id})"
                      style="margin-bottom:6px">
                ✨ Создать встречу TeleМост автоматически
              </button>
            ` : ''}
            <div class="form-hint">Клиент увидит ссылку в своём ЛК после оплаты</div>
          </div>

          <!-- Чат с клиентом -->
          <div class="form-group">
            <label class="form-label">💬 Чат с клиентом</label>
            <button class="btn btn-outline btn-sm" onclick="openConsultantChat(${booking.id})"
                    style="gap:6px">
              Открыть чат
            </button>
            <div class="form-hint">Внутренний чат — виден только вам и клиенту</div>
          </div>

          <!-- Заметки консультанта -->
          <div class="form-group">
            <label class="form-label">📝 Заметки (приватные)</label>
            <textarea class="form-textarea" id="modal-notes" rows="3"
              placeholder="Ваши внутренние заметки — клиент не видит">${booking.consultant_notes || ''}</textarea>
          </div>

          <!-- Смена статуса -->
          <div class="form-group">
            <label class="form-label">Статус встречи</label>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              ${['paid','in_progress','completed','cancelled'].map(s => {
                const labels = { paid:'✓ Оплачено', in_progress:'▶ Идёт встреча', completed:'✔ Завершено', cancelled:'✕ Отменить' }
                const active = booking.status === s
                return `<button class="btn btn-sm ${active ? 'btn-primary' : 'btn-outline'}"
                  onclick="setBookingStatus(${booking.id},'${s}')">${labels[s]}</button>`
              }).join('')}
            </div>
          </div>

        </div>

        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="closeModal()">Закрыть</button>
          <button class="btn btn-primary" onclick="saveBookingDetails(${booking.id})">
            💾 Сохранить изменения
          </button>
        </div>

      </div>
    </div>
  `
}

function closeModal() {
  document.getElementById('modal-root').innerHTML = ''
}
window.closeModal = closeModal

// Предложить время клиенту
window.proposeBookingTime = async (id) => {
  const input = document.getElementById('modal-propose-time')
  if (!input || !input.value) {
    toast('Выберите дату и время', 'error')
    return
  }
  // Преобразуем локальное время в ISO (с часовым поясом консультанта)
  const localDate = new Date(input.value)
  if (isNaN(localDate.getTime())) {
    toast('Некорректная дата', 'error')
    return
  }
  const btn = document.querySelector('[onclick="proposeBookingTime(' + id + ')"]')
  if (btn) { btn.disabled = true; btn.textContent = 'Отправляем...' }
  try {
    await API.post(`/bookings/${id}/propose-time`, { proposed_time: localDate.toISOString() })
    toast('Предложение отправлено клиенту ✅', 'success', 4000)
    closeModal()
    if (currentPage === 'bookings') await loadBookingsList()
    if (currentPage === 'dashboard') await renderDashboard()
  } catch (err) {
    toast(err.message, 'error')
    if (btn) { btn.disabled = false; btn.textContent = '📨 Отправить предложение' }
  }
}

window.saveBookingLink = async (id) => {
  const link = document.getElementById('modal-link')?.value.trim()
  try {
    await API.patch(`/bookings/${id}`, { meeting_link: link })
    toast('Ссылка сохранена', 'success')
  } catch (err) { toast(err.message, 'error') }
}

window.saveBookingDetails = async (id) => {
  const link  = document.getElementById('modal-link')?.value.trim()
  const notes = document.getElementById('modal-notes')?.value.trim()
  try {
    await API.patch(`/bookings/${id}`, {
      meeting_link: link || undefined,
      consultant_notes: notes || undefined
    })
    toast('Сохранено', 'success')
    closeModal()
    if (currentPage === 'bookings') await loadBookingsList()
    if (currentPage === 'dashboard') await renderDashboard()
  } catch (err) { toast(err.message, 'error') }
}

window.setBookingStatus = async (id, status) => {
  try {
    await API.patch(`/bookings/${id}`, { status })
    toast('Статус обновлён', 'success')
    closeModal()
    if (currentPage === 'bookings') await loadBookingsList()
    if (currentPage === 'dashboard') await renderDashboard()
  } catch (err) { toast(err.message, 'error') }
}

// ============================================================
// 📅 Расписание
// ============================================================

async function renderSlots() {
  const main = document.getElementById('main')

  main.innerHTML = `
    <h2 style="margin-bottom:20px">Расписание</h2>

    <!-- Добавить несколько слотов сразу -->
    <div class="card" style="margin-bottom:24px">
      <div class="card-header"><div class="card-title">➕ Быстрое добавление слотов</div></div>
      <div class="card-body">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div class="form-group" style="margin:0">
            <label class="form-label">День</label>
            <input class="form-input" type="date" id="slot-date"
              min="${mskToday()}">
          </div>
          <div class="form-group" style="margin:0">
            <label class="form-label">Продолжительность</label>
            <select class="form-input" id="slot-duration">
              <option value="60">1 час</option>
              <option value="90">1.5 часа</option>
              <option value="120">2 часа</option>
            </select>
          </div>
        </div>

        <div class="form-group" style="margin-top:12px">
          <label class="form-label">Время (${getConsultantTZLabel()}) — можно несколько через пробел или запятую</label>
          <input class="form-input" id="slot-times" type="text"
            placeholder="Например: 10:00 12:00 15:00 18:00">
          <div class="form-hint">Все указанные слоты будут добавлены на выбранный день</div>
        </div>

        <div id="slot-add-alert" style="margin-bottom:8px"></div>
        <button class="btn btn-primary" onclick="addSlots()">Добавить слоты</button>
      </div>
    </div>

    <!-- Список существующих слотов -->
    <div class="card">
      <div class="card-header">
        <div class="card-title">📅 Ближайшие слоты (30 дней)</div>
        <button class="btn btn-ghost btn-sm" onclick="loadSlotsList()">🔄 Обновить</button>
      </div>
      <div class="card-body" id="slots-list">
        <div class="loading-overlay"><div class="spinner"></div> Загрузка...</div>
      </div>
    </div>
  `

  await loadSlotsList()
}

async function loadSlotsList() {
  const container = document.getElementById('slots-list')
  if (!container) return

  const from = new Date().toISOString().split('T')[0]
  const to   = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  const { slots } = await API.get(`/slots?consultant_id=1&from=${from}&to=${to}&all=1`)

  if (!slots || slots.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="padding:20px">
        <p>Слотов нет</p>
        <div class="empty-hint">Добавьте доступные часы через форму выше</div>
      </div>
    `
    return
  }

  const tz = getConsultantTZ()

  // Группируем по дням
  const byDay = {}
  slots.forEach(s => {
    const day = new Date(s.starts_at).toLocaleDateString('ru-RU', {
      timeZone: tz, weekday: 'long', day: 'numeric', month: 'long'
    })
    if (!byDay[day]) byDay[day] = []
    byDay[day].push(s)
  })

  container.innerHTML = Object.entries(byDay).map(([day, daySlots]) => `
    <div style="margin-bottom:16px">
      <div style="font-size:13px;font-weight:600;text-transform:capitalize;
                  color:var(--c-muted);margin-bottom:8px;padding-bottom:4px;
                  border-bottom:1px solid var(--c-border)">${day}</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px">
        ${daySlots.map(s => {
          const time = new Date(s.starts_at).toLocaleTimeString('ru-RU', {
            hour: '2-digit', minute: '2-digit', timeZone: tz
          })
          const isBooked = !s.is_available
          return `
            <div style="
              display:flex;align-items:center;gap:6px;padding:6px 12px;border-radius:6px;
              background:${isBooked ? '#fee2e2' : '#f0fdf4'};
              border:1px solid ${isBooked ? '#fca5a5' : '#86efac'};
              font-size:13px;font-weight:500;
            ">
              <span>${time}</span>
              ${isBooked
                ? `<span style="font-size:11px;color:#dc2626">занят</span>`
                : `<button onclick="deleteSlot(${s.id})"
                    style="background:none;border:none;cursor:pointer;color:var(--c-muted);padding:0;font-size:14px;line-height:1"
                    title="Удалить слот">✕</button>`
              }
            </div>
          `
        }).join('')}
      </div>
    </div>
  `).join('')
}

window.addSlots = async () => {
  const dateVal  = document.getElementById('slot-date').value
  const timesVal = document.getElementById('slot-times').value.trim()
  const duration = parseInt(document.getElementById('slot-duration').value) || 60
  const alertBox = document.getElementById('slot-add-alert')

  if (!dateVal)  { showAlert(alertBox, 'error', 'Выберите дату'); return }
  if (!timesVal) { showAlert(alertBox, 'error', 'Укажите хотя бы одно время'); return }

  // Парсим времена: "10:00 12:00" или "10:00, 12:00"
  const times = timesVal.split(/[\s,]+/).filter(t => /^\d{1,2}:\d{2}$/.test(t.trim()))
  if (times.length === 0) {
    showAlert(alertBox, 'error', 'Не удалось распознать время. Используйте формат HH:MM')
    return
  }

  const btn = document.querySelector('[onclick="addSlots()"]')
  setLoading(btn, true, 'Добавляем...')

  // Смещение timezone консультанта относительно UTC (в часах)
  const tzOffset = tzOffsetHours(getConsultantTZ())

  let added = 0, errors = 0
  for (const t of times) {
    const [h, m] = t.split(':').map(Number)
    // Строим UTC напрямую из даты+времени в timezone консультанта
    // Формула: UTC = local_time - tzOffset
    // НЕ используем new Date(строка без Z) — браузер трактует её как локальное время браузера,
    // что при совпадении TZ браузера и консультанта даёт двойное смещение
    const [year, mon, day] = dateVal.split('-').map(Number)
    const hUTC = h - tzOffset  // может быть дробным для полуцелых зон, но это редкость
    const startsUTC = new Date(Date.UTC(year, mon - 1, day, Math.floor(hUTC), m - (hUTC % 1 !== 0 ? 30 : 0), 0))
    const endsUTC   = new Date(startsUTC.getTime() + duration * 60 * 1000)

    try {
      await API.post('/slots', {
        consultant_id: 1,
        starts_at: startsUTC.toISOString(),
        ends_at:   endsUTC.toISOString()
      })
      added++
    } catch {
      errors++
    }
  }

  setLoading(btn, false)

  if (added > 0)  { toast(`✓ Добавлено слотов: ${added}`, 'success') }
  if (errors > 0) { toast(`⚠ Уже существовали: ${errors}`, 'warning') }

  document.getElementById('slot-times').value = ''
  await loadSlotsList()
}

window.deleteSlot = async (slotId) => {
  try {
    await API.delete(`/slots/${slotId}`)
    toast('Слот удалён', 'info')
    await loadSlotsList()
  } catch (err) {
    toast(err.message, 'error')
  }
}

// ============================================================
// 🤝 Сопровождение
// ============================================================

async function renderSupport() {
  const main = document.getElementById('main')

  // Загружаем тарифы сопровождения и список клиентов
  const [{ tariffs }, { bookings: clients }] = await Promise.all([
    API.get('/tariffs'),
    API.get('/bookings/consultant/list?status=completed')
  ])

  const supportTariffs = tariffs.filter(t => t.is_support)

  // Список уникальных клиентов из завершённых записей
  const clientMap = {}
  clients.forEach(b => {
    if (!clientMap[b.user_id]) {
      clientMap[b.user_id] = {
        id: b.user_id,
        name: b.client_name || b.client_email || `Клиент #${b.user_id}`,
        email: b.client_email
      }
    }
  })
  const clientList = Object.values(clientMap)

  main.innerHTML = `
    <h2 style="margin-bottom:6px">Предложить сопровождение</h2>
    <p style="color:var(--c-muted);font-size:14px;margin-bottom:24px">
      Предложите клиенту сопровождение после первичной консультации.
      Клиент увидит предложение в своём ЛК и сможет оплатить.
    </p>

    <!-- Форма предложения -->
    <div class="card" style="max-width:560px;margin-bottom:28px">
      <div class="card-header"><div class="card-title">➕ Новое предложение</div></div>
      <div class="card-body">
        <div class="form-group">
          <label class="form-label">Клиент</label>
          ${clientList.length === 0 ? `
            <div class="alert alert-info">
              Завершённых консультаций пока нет — предложение сопровождения можно отправить только после первой встречи.
            </div>
          ` : `
            <select class="form-input" id="sup-client">
              <option value="">— выберите клиента —</option>
              ${clientList.map(c => `
                <option value="${c.id}">${c.name}${c.email ? ` (${c.email})` : ''}</option>
              `).join('')}
            </select>
            <div class="form-hint">Или введите ID клиента вручную:</div>
            <input class="form-input" id="sup-client-id" type="number"
              placeholder="user_id" style="margin-top:6px">
          `}
        </div>

        <div class="form-group">
          <label class="form-label">Тариф</label>
          <select class="form-input" id="sup-tariff" onchange="updateSupportPrice()">
            <option value="">— выберите тариф —</option>
            ${supportTariffs.map(t => `
              <option value="${t.id}" data-price="${t.price_rub}">${t.name} — ${Fmt.money(t.price_rub)}</option>
            `).join('')}
          </select>
        </div>

        <div class="form-group">
          <label class="form-label">Стоимость (₽) — можно изменить</label>
          <input class="form-input" id="sup-price" type="number" placeholder="Например: 15000">
          <div class="form-hint">Оставьте пустым — будет применён стандартный тариф</div>
        </div>

        <div class="form-group">
          <label class="form-label">Комментарий для клиента</label>
          <textarea class="form-textarea" id="sup-comment" rows="3"
            placeholder="Что вы обсудили, что предлагаете, почему это поможет..."></textarea>
        </div>

        <div id="sup-alert" style="margin-bottom:8px"></div>

        <button class="btn btn-primary" onclick="sendSupportOffer()">
          📨 Отправить предложение
        </button>
      </div>
    </div>

    <!-- Активные контракты -->
    <h3 style="font-size:14px;font-weight:700;margin-bottom:14px;text-transform:uppercase;
               letter-spacing:.06em;color:var(--c-muted)">Действующие контракты</h3>
    <div id="support-contracts">
      <div class="loading-overlay"><div class="spinner"></div></div>
    </div>
  `

  await loadSupportContracts()
}

window.updateSupportPrice = () => {
  const sel    = document.getElementById('sup-tariff')
  const option = sel?.selectedOptions[0]
  const price  = option?.dataset.price
  if (price) document.getElementById('sup-price').value = price
}

window.sendSupportOffer = async () => {
  const alertBox = document.getElementById('sup-alert')
  const sel = document.getElementById('sup-client')
  const idInput = document.getElementById('sup-client-id')

  const userId   = parseInt(idInput?.value) || parseInt(sel?.value)
  const tariffId = parseInt(document.getElementById('sup-tariff').value)
  const price    = parseInt(document.getElementById('sup-price').value) || undefined
  const comment  = document.getElementById('sup-comment').value.trim()

  if (!userId)   { showAlert(alertBox, 'error', 'Выберите или укажите клиента'); return }
  if (!tariffId) { showAlert(alertBox, 'error', 'Выберите тариф'); return }

  const btn = document.querySelector('[onclick="sendSupportOffer()"]')
  setLoading(btn, true, 'Отправляем...')

  try {
    await API.post('/consultant/support-offer', {
      user_id:           userId,
      tariff_id:         tariffId,
      custom_price_rub:  price,
      consultant_comment: comment || undefined
    })
    showAlert(alertBox, 'success', 'Предложение отправлено! Клиент увидит его в ЛК.')
    document.getElementById('sup-comment').value = ''
    document.getElementById('sup-price').value   = ''
    if (document.getElementById('sup-client-id')) document.getElementById('sup-client-id').value = ''
    await loadSupportContracts()
  } catch (err) {
    showAlert(alertBox, 'error', err.message)
  } finally {
    setLoading(btn, false)
  }
}

async function loadSupportContracts() {
  const container = document.getElementById('support-contracts')
  if (!container) return

  try {
    // Получаем все контракты через отдельный эндпоинт
    const { contracts } = await API.get('/consultant/support-contracts')

    if (!contracts || contracts.length === 0) {
      container.innerHTML = `
        <div class="empty-state" style="padding:20px">
          <p>Контрактов пока нет</p>
        </div>
      `
      return
    }

    const statusMap = {
      awaiting_payment: ['#fef3c7','#92400e','⏳ Ожидает оплаты'],
      active:           ['#d1fae5','#065f46','✅ Активно'],
      completed:        ['#e0f2fe','#0369a1','✔ Завершено'],
      cancelled:        ['#fee2e2','#991b1b','✕ Отменено'],
    }

    container.innerHTML = `
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Клиент</th>
              <th>Тариф</th>
              <th>Сумма</th>
              <th>Статус</th>
              <th>Создан</th>
            </tr>
          </thead>
          <tbody>
            ${contracts.map(c => {
              const [bg, color, label] = statusMap[c.status] || ['#f3f4f6','#374151', c.status]
              return `
                <tr>
                  <td style="color:var(--c-muted);font-size:12px">#${c.id}</td>
                  <td>${c.client_name || `Клиент #${c.user_id}`}</td>
                  <td>${c.tariff_name || '—'}</td>
                  <td>${Fmt.money(c.custom_price_rub || c.tariff_price || 0)}</td>
                  <td><span style="padding:3px 8px;border-radius:12px;font-size:12px;background:${bg};color:${color}">${label}</span></td>
                  <td style="font-size:12px;color:var(--c-muted)">${Fmt.dateShort(c.created_at)}</td>
                </tr>
              `
            }).join('')}
          </tbody>
        </table>
      </div>
    `
  } catch (err) {
    container.innerHTML = `<div class="alert alert-error">${err.message}</div>`
  }
}

// ============================================================
// ⚙️ Профиль консультанта
// ============================================================

async function renderProfile() {
  const main = document.getElementById('main')
  const { profile } = await API.get('/consultant/profile')
  const p = profile || {}

  main.innerHTML = `
    <h2 style="margin-bottom:24px">Профиль консультанта</h2>

    <div class="card" style="max-width:560px;margin-bottom:16px">
      <div class="card-header"><div class="card-title">Публичная информация</div></div>
      <div class="card-body">
        <div id="profile-alert"></div>

        <div class="form-group">
          <label class="form-label">Короткое описание (карточка)</label>
          <textarea class="form-textarea" id="p-bio-short" rows="2">${p.bio_short || ''}</textarea>
          <div class="form-hint">Отображается на главной странице под именем</div>
        </div>

        <div class="form-group">
          <label class="form-label">Полное описание (страница)</label>
          <textarea class="form-textarea" id="p-bio-full" rows="5">${p.bio_full || ''}</textarea>
        </div>

        <div class="form-group">
          <label class="form-label">Должность / специализация</label>
          <input class="form-input" id="p-title" value="${p.title || ''}">
        </div>

        <button class="btn btn-primary" onclick="saveProfile()">Сохранить</button>
      </div>
    </div>

    <div class="card" style="max-width:560px;margin-bottom:16px">
      <div class="card-header"><div class="card-title">Контакты и уведомления</div></div>
      <div class="card-body">
        <div class="form-group">
          <label class="form-label">Email для уведомлений</label>
          <input class="form-input" id="p-email" type="email" value="${p.email || ''}">
        </div>

        <div class="form-group">
          <label class="form-label">Telegram Chat ID (для уведомлений)</label>
          <input class="form-input" id="p-tgchat" value="${p.telegram_chat_id || ''}" placeholder="123456789">
          <div class="form-hint">
            Получите свой chat_id через бот
            <a href="https://t.me/userinfobot" target="_blank">@userinfobot</a>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">🕐 Часовой пояс (для слотов)</label>
          <select class="form-input" id="p-timezone" style="cursor:pointer">
            ${[
              ['Europe/Moscow',      'Москва (UTC+3)'],
              ['Europe/Kaliningrad', 'Калининград (UTC+2)'],
              ['Europe/Samara',      'Самара (UTC+4)'],
              ['Asia/Yekaterinburg','Екатеринбург (UTC+5)'],
              ['Asia/Omsk',         'Омск (UTC+6)'],
              ['Asia/Krasnoyarsk',  'Красноярск (UTC+7)'],
              ['Asia/Irkutsk',      'Иркутск (UTC+8)'],
              ['Asia/Yakutsk',      'Якутск (UTC+9)'],
              ['Asia/Vladivostok',  'Владивосток (UTC+10)'],
              ['Asia/Magadan',      'Магадан (UTC+11)'],
              ['Asia/Kamchatka',    'Камчатка (UTC+12)'],
            ].map(([tz, label]) =>
              `<option value="${tz}" ${(p.timezone || 'Europe/Moscow') === tz ? 'selected' : ''}>${label}</option>`
            ).join('')}
          </select>
          <div class="form-hint">Время слотов вводится и отображается в этом часовом поясе</div>
        </div>

        <button class="btn btn-outline" onclick="saveContacts()">Сохранить контакты</button>
      </div>
    </div>

    <div class="card" style="max-width:560px">
      <div class="card-header"><div class="card-title">Форматы встреч и контакты</div></div>
      <div class="card-body">
        <div style="display:flex;flex-direction:column;gap:12px;margin-bottom:20px">
          ${[
            { key: 'supports_telemost', label: '📹 TeleМост (видеозвонок)', val: p.supports_telemost },
            { key: 'supports_telegram', label: '💬 Telegram / Макс',       val: p.supports_telegram },
            { key: 'supports_phone',    label: '📞 Телефон',               val: p.supports_phone    },
          ].map(f => `
            <label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-size:14px">
              <input type="checkbox" id="${f.key}" ${f.val ? 'checked' : ''} style="width:16px;height:16px">
              ${f.label}
            </label>
          `).join('')}
        </div>

        <div style="border-top:1px solid var(--c-border);padding-top:16px;margin-bottom:16px">
          <div style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--c-muted);margin-bottom:12px">
            Ваши контакты для клиентов
          </div>

          <div class="form-group">
            <label class="form-label">📞 Телефон</label>
            <input class="form-input" id="p-phone" value="${p.phone || ''}" placeholder="+7 (999) 123-45-67">
            <div class="form-hint">Показывается клиенту при выборе формата «Телефон»</div>
          </div>

          <div class="form-group">
            <label class="form-label">💬 Telegram-ссылка</label>
            <input class="form-input" id="p-telegram-url" value="${p.telegram_url || ''}" placeholder="https://t.me/your_username">
            <div class="form-hint">Ссылка для перехода в Telegram</div>
          </div>

          <div class="form-group">
            <label class="form-label">💙 Макс-ссылка</label>
            <input class="form-input" id="p-max-url" value="${p.max_url || ''}" placeholder="https://max.ru/your_username">
            <div class="form-hint">Ссылка на ваш профиль в Макс (ВКонтакте)</div>
          </div>
        </div>

        <button class="btn btn-outline" onclick="saveFormats()">Сохранить форматы и контакты</button>
      </div>
    </div>
  `
}

window.saveProfile = async () => {
  const alertBox = document.getElementById('profile-alert')
  try {
    await API.patch('/consultant/profile', {
      bio_short: document.getElementById('p-bio-short').value.trim() || undefined,
      bio_full:  document.getElementById('p-bio-full').value.trim()  || undefined,
      title:     document.getElementById('p-title').value.trim()     || undefined,
    })
    showAlert(alertBox, 'success', 'Профиль обновлён')
  } catch (err) {
    showAlert(alertBox, 'error', err.message)
  }
}

window.saveContacts = async () => {
  try {
    const tz = document.getElementById('p-timezone')?.value
    await API.patch('/consultant/profile', {
      email:            document.getElementById('p-email').value.trim()  || undefined,
      telegram_chat_id: document.getElementById('p-tgchat').value.trim() || undefined,
      timezone:         tz || undefined,
    })
    // Обновляем глобальный TZ сразу
    if (tz) window._consultantTZ = tz
    toast('Контакты сохранены', 'success')
  } catch (err) { toast(err.message, 'error') }
}

window.saveFormats = async () => {
  try {
    await API.patch('/consultant/profile', {
      supports_telemost: document.getElementById('supports_telemost')?.checked,
      supports_telegram: document.getElementById('supports_telegram')?.checked,
      supports_phone:    document.getElementById('supports_phone')?.checked,
      phone:        document.getElementById('p-phone')?.value.trim()       || undefined,
      telegram_url: document.getElementById('p-telegram-url')?.value.trim() || undefined,
      max_url:      document.getElementById('p-max-url')?.value.trim()       || undefined,
    })
    toast('Форматы и контакты сохранены', 'success')
  } catch (err) { toast(err.message, 'error') }
}

// ============================================================
// 🕒 Утилиты: дата/время с учётом timezone консультанта
// ============================================================

// Читаемое название TZ для UI
function getConsultantTZLabel() {
  const tz = getConsultantTZ()
  const map = {
    'Europe/Moscow':      'МСК',
    'Europe/Kaliningrad': 'КЛД',
    'Europe/Samara':      'СМР',
    'Asia/Yekaterinburg': 'ЕКБ',
    'Asia/Omsk':          'ОМС',
    'Asia/Krasnoyarsk':   'КРС',
    'Asia/Irkutsk':       'ИРК',
    'Asia/Yakutsk':       'ЯКТ',
    'Asia/Vladivostok':   'ВЛД',
    'Asia/Magadan':       'МГД',
    'Asia/Kamchatka':     'КМЧ',
  }
  return map[tz] || tz
}

// Текущая дата в timezone консультанта (YYYY-MM-DD)
function mskToday() {
  const tz = getConsultantTZ()
  const now = new Date()
  const local = new Date(now.toLocaleString('en-US', { timeZone: tz }))
  const y = local.getFullYear()
  const m = String(local.getMonth() + 1).padStart(2, '0')
  const d = String(local.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// ============================================================
// TeleМост — автосоздание встречи
// ============================================================

window.autoCreateTelemost = async (bookingId) => {
  const btn = event.target
  setLoading(btn, true, 'Создаём...')
  try {
    const resp = await API.post(`/telemost/create/${bookingId}`)
    if (resp.ok && resp.link) {
      const linkInput = document.getElementById('modal-link')
      if (linkInput) linkInput.value = resp.link
      if (resp.existing) {
        toast('Ссылка уже была создана — загружена в поле', 'info')
      } else {
        toast('✓ Встреча TeleМост создана! Сохраните ссылку.', 'success')
      }
    } else if (resp.placeholder) {
      toast(resp.message, 'warning', 8000)
      window.open(resp.manual_url, '_blank')
    } else {
      toast(resp.error || 'Ошибка создания встречи', 'error')
    }
  } catch (err) {
    toast(err.message, 'error')
  } finally {
    setLoading(btn, false)
  }
}

// ============================================================
// Чат консультанта с клиентом
// ============================================================

let consultantChatTimer = null

window.openConsultantChat = async (bookingId) => {
  // Закрываем основную модалку и открываем чат-модалку
  closeModal()

  const modal = document.getElementById('modal-root')
  modal.innerHTML = `
    <div class="modal-overlay" onclick="closeConsultantChat()">
      <div class="modal" onclick="event.stopPropagation()"
           style="max-width:520px;height:80vh;display:flex;flex-direction:column">

        <div class="modal-header">
          <div class="modal-title">💬 Чат с клиентом — запись #${bookingId}</div>
          <button class="modal-close" onclick="closeConsultantChat()">✕</button>
        </div>

        <!-- Сообщения -->
        <div id="cons-chat-messages" style="
          flex:1;overflow-y:auto;padding:16px;
          display:flex;flex-direction:column;gap:10px;
          background:#f8f9fa;
        ">
          <div class="loading-overlay"><div class="spinner"></div> Загрузка...</div>
        </div>

        <!-- Ввод -->
        <div style="padding:12px 16px;border-top:1px solid var(--c-border);background:#fff">
          <div style="display:flex;gap:8px">
            <textarea id="cons-chat-input" class="form-textarea"
              rows="2" style="margin:0;flex:1;resize:none;font-size:14px"
              placeholder="Напишите клиенту..."
              onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendConsultantMessage(${bookingId})}">
            </textarea>
            <button class="btn btn-primary" style="align-self:flex-end;white-space:nowrap"
                    onclick="sendConsultantMessage(${bookingId})">
              Отправить
            </button>
          </div>
          <div style="font-size:11px;color:var(--c-muted);margin-top:4px">
            Enter — отправить · Shift+Enter — новая строка
          </div>
        </div>

      </div>
    </div>
  `

  await loadConsultantChatMessages(bookingId)
  try { await API.post(`/chat/${bookingId}/read`) } catch(_) {}

  consultantChatTimer = setInterval(async () => {
    await loadConsultantChatMessages(bookingId, true)
  }, 6000)
}
window.closeConsultantChat = () => {
  if (consultantChatTimer) { clearInterval(consultantChatTimer); consultantChatTimer = null }
  document.getElementById('modal-root').innerHTML = ''
}

async function loadConsultantChatMessages(bookingId, silent = false) {
  const container = document.getElementById('cons-chat-messages')
  if (!container) return

  try {
    const { messages, unread } = await API.get(`/chat/${bookingId}`)
    const wasAtBottom = container.scrollHeight - container.scrollTop <= container.clientHeight + 50

    if (messages.length === 0) {
      container.innerHTML = `
        <div style="text-align:center;color:var(--c-muted);padding:40px 20px;font-size:14px">
          Сообщений пока нет.<br>Клиент сможет написать после оплаты.
        </div>
      `
      return
    }

    container.innerHTML = messages.map(m => {
      const isMe = m.sender_type === 'consultant'
      const time = new Date(m.created_at).toLocaleTimeString('ru-RU', {
        hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow'
      })
      const date = new Date(m.created_at).toLocaleDateString('ru-RU', {
        day: 'numeric', month: 'short', timeZone: 'Europe/Moscow'
      })
      const readMark = (isMe && m.is_read) ? ' ✓' : ''
      return `
        <div style="display:flex;flex-direction:column;align-items:${isMe ? 'flex-end' : 'flex-start'};gap:2px">
          <div style="
            max-width:80%;padding:10px 14px;
            border-radius:${isMe ? '14px 14px 4px 14px' : '14px 14px 14px 4px'};
            background:${isMe ? 'var(--c-primary)' : '#fff'};
            color:${isMe ? '#fff' : 'var(--c-text)'};
            font-size:14px;line-height:1.5;
            box-shadow:0 1px 3px rgba(0,0,0,0.08);
            white-space:pre-wrap;word-break:break-word;
          ">${escHtmlC(m.body)}</div>
          <div style="font-size:11px;color:var(--c-muted);padding:0 4px">
            ${isMe ? 'Вы' : 'Клиент'} · ${date}, ${time} МСК${readMark}
          </div>
        </div>
      `
    }).join('')

    if (wasAtBottom || !silent) container.scrollTop = container.scrollHeight
  } catch (err) {
    if (!silent) container.innerHTML = `<div class="alert alert-error">${err.message}</div>`
  }
}

window.sendConsultantMessage = async (bookingId) => {
  const input = document.getElementById('cons-chat-input')
  if (!input) return
  const text = input.value.trim()
  if (!text) return
  input.value = ''
  input.disabled = true
  try {
    await API.post(`/chat/${bookingId}`, { body: text })
    await loadConsultantChatMessages(bookingId, true)
    const c = document.getElementById('cons-chat-messages')
    if (c) c.scrollTop = c.scrollHeight
  } catch (err) {
    input.value = text
    toast(err.message, 'error')
  } finally {
    input.disabled = false
    input.focus()
  }
}

function escHtmlC(str) {
  return str
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// Показываем количество непрочитанных сообщений на дашборде (периодически)
async function checkUnreadChats() {
  try {
    const { bookings } = await API.get('/bookings/consultant/list?status=paid&limit=20')
    let totalUnread = 0
    for (const b of (bookings || [])) {
      const { unread } = await API.get(`/chat/${b.id}`)
      totalUnread += unread || 0
    }
    if (totalUnread > 0) {
      const badge = document.getElementById('chat-unread-badge')
      if (badge) badge.textContent = totalUnread > 9 ? '9+' : String(totalUnread)
    }
  } catch(_) {}
}

// ---- Старт ----
init()
