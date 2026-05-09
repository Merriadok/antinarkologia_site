// ============================================================
// Уведомления: email (через SMTP/API), Telegram
// ============================================================

import type { Bindings } from '../types'

// ---- Email (через MailChannels или SMTP — настраивается через env) ----

interface EmailOptions {
  to: string
  subject: string
  text: string
  html?: string
}

export async function sendEmail(env: Bindings, opts: EmailOptions): Promise<boolean> {
  // ⚠️ EMAIL ЗАКОНСЕРВИРОВАН: почтовый сервер не настроен в текущем тарифе.
  // Функция тихо возвращает false и не делает никаких сетевых запросов.
  // Чтобы включить: настройте SMTP-relay (Resend, SendGrid, Mailgun) и раскомментируйте код ниже.
  // Проверяем наличие конфига — если задан EMAIL_ENABLED=true, пробуем отправить
  if (env.EMAIL_ENABLED !== 'true') {
    console.log(`[email] disabled — skipping send to ${opts.to} (${opts.subject})`)
    return false
  }

  // --- Код отправки (активируется при EMAIL_ENABLED=true) ---
  // Используем MailChannels (работает бесплатно в Cloudflare Workers)
  // При необходимости можно заменить на SMTP-relay (Resend, SendGrid, etc.)
  try {
    const response = await fetch('https://api.mailchannels.net/tx/v1/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: opts.to }] }],
        from: { email: env.EMAIL_FROM || 'noreply@antinarkologia.ru', name: 'АНТИНаркология' },
        subject: opts.subject,
        content: [
          { type: 'text/plain', value: opts.text },
          ...(opts.html ? [{ type: 'text/html', value: opts.html }] : [])
        ]
      })
    })
    return response.ok
  } catch {
    return false
  }
}

// ---- Telegram (для консультанта) ----

export async function sendTelegram(botToken: string, chatId: string, text: string): Promise<boolean> {
  if (!botToken || !chatId) return false
  try {
    const resp = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
      }
    )
    return resp.ok
  } catch {
    return false
  }
}

// ---- Шаблоны уведомлений ----

export function bookingCreatedEmail(data: {
  displayName: string
  tariffName: string
  slotDate: string
  meetingFormat: string
  paymentUrl: string
}): { subject: string; text: string; html: string } {
  const subject = `Ваша запись создана — ${data.tariffName}`
  const text = `
Здравствуйте${data.displayName ? `, ${data.displayName}` : ''}!

Вы записались на «${data.tariffName}».
Время: ${data.slotDate}
Формат: ${data.meetingFormat}

Для подтверждения записи оплатите, пожалуйста:
${data.paymentUrl}

После оплаты вы получите подтверждение и контакт консультанта.

Если возникнут вопросы — напишите нам.
АНТИНаркология
  `.trim()

  const html = `
<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
  <h2 style="color: #2563eb;">АНТИНаркология</h2>
  <p>Здравствуйте${data.displayName ? `, <strong>${data.displayName}</strong>` : ''}!</p>
  <p>Вы записались на <strong>«${data.tariffName}»</strong>.</p>
  <table style="border-collapse: collapse; width: 100%; margin: 16px 0;">
    <tr><td style="padding: 8px; color: #666;">Время:</td><td style="padding: 8px;"><strong>${data.slotDate}</strong></td></tr>
    <tr><td style="padding: 8px; color: #666;">Формат:</td><td style="padding: 8px;">${data.meetingFormat}</td></tr>
  </table>
  <a href="${data.paymentUrl}" style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold;">Оплатить →</a>
  <p style="color: #666; font-size: 14px; margin-top: 24px;">После оплаты вы получите подтверждение и контакт консультанта.</p>
</div>
  `.trim()

  return { subject, text, html }
}

export function bookingPaidEmail(data: {
  displayName: string
  tariffName: string
  slotDate: string
  meetingFormat: string
  consultantContact: string
  lkUrl: string
}): { subject: string; text: string; html: string } {
  const subject = `Оплата прошла — ждём вас!`
  const text = `
Оплата получена, спасибо!

Детали вашей записи:
  Услуга: ${data.tariffName}
  Время: ${data.slotDate}
  Формат: ${data.meetingFormat}
  Контакт консультанта: ${data.consultantContact}

Ваш личный кабинет: ${data.lkUrl}
  `.trim()

  const html = `
<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
  <h2 style="color: #16a34a;">✓ Оплата получена</h2>
  <p>Детали вашей записи:</p>
  <table style="border-collapse: collapse; width: 100%; margin: 16px 0;">
    <tr><td style="padding: 8px; color: #666;">Услуга:</td><td style="padding: 8px;"><strong>${data.tariffName}</strong></td></tr>
    <tr><td style="padding: 8px; color: #666;">Время:</td><td style="padding: 8px;"><strong>${data.slotDate}</strong></td></tr>
    <tr><td style="padding: 8px; color: #666;">Формат:</td><td style="padding: 8px;">${data.meetingFormat}</td></tr>
    <tr><td style="padding: 8px; color: #666;">Консультант:</td><td style="padding: 8px;">${data.consultantContact}</td></tr>
  </table>
  <a href="${data.lkUrl}" style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold;">Мой кабинет →</a>
</div>
  `.trim()

  return { subject, text, html }
}

export function newBookingConsultantTelegram(data: {
  bookingId: number
  tariffName: string
  slotDate: string
  meetingFormat: string
  clientContact: string
  clientQuestion: string
  panelUrl: string
}): string {
  return `
🔔 <b>Новая запись #${data.bookingId}</b>

📋 Услуга: ${data.tariffName}
📅 Время: ${data.slotDate}
📞 Формат: ${data.meetingFormat}
💬 Контакт клиента: ${data.clientContact || 'не указан'}

📝 Вопрос:
${data.clientQuestion || '—'}

👉 <a href="${data.panelUrl}">Открыть в панели</a>
  `.trim()
}
