// ============================================================
// Service Worker — АНТИНаркология
// Обрабатывает Push-уведомления от сервера
// ============================================================

const CACHE_NAME = 'antinarco-v1'

// ---- Push-уведомления ----
self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch (_) {
    data = { title: 'АНТИНаркология', body: event.data ? event.data.text() : '' }
  }

  const title   = data.title   || 'АНТИНаркология'
  const body    = data.body    || ''
  const icon    = data.icon    || '/static/favicon.svg'
  const badge   = data.badge   || '/static/favicon.svg'
  const url     = data.url     || '/lk.html'
  const tag     = data.tag     || 'antinarco-default'

  const options = {
    body,
    icon,
    badge,
    tag,
    data: { url },
    vibrate: [200, 100, 200],
    requireInteraction: data.requireInteraction || false,
    actions: data.actions || []
  }

  event.waitUntil(
    self.registration.showNotification(title, options)
  )
})

// ---- Клик по уведомлению ----
self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const url = event.notification.data?.url || '/lk.html'

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Если уже открыта вкладка с сайтом — фокусируемся на ней
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.focus()
          client.navigate(url)
          return
        }
      }
      // Иначе открываем новую
      if (clients.openWindow) return clients.openWindow(url)
    })
  )
})

// ---- Активация ----
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME)
          .map(name => caches.delete(name))
      )
    )
  )
})
