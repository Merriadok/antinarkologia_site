// ============================================================
// Интеграция с ЮKassa
// Документация: https://yookassa.ru/developers/api
// ============================================================

export interface YukassaPaymentRequest {
  amount: { value: string; currency: 'RUB' }
  confirmation: { type: 'redirect'; return_url: string }
  capture: boolean
  description: string
  metadata?: Record<string, string>
}

export interface YukassaPayment {
  id: string
  status: 'pending' | 'waiting_for_capture' | 'succeeded' | 'canceled'
  amount: { value: string; currency: string }
  confirmation?: { type: string; confirmation_url: string }
  payment_method?: { type: string }
  captured_at?: string
  metadata?: Record<string, string>
}

export class YukassaClient {
  private shopId: string
  private secretKey: string
  private baseUrl = 'https://api.yookassa.ru/v3'

  constructor(shopId: string, secretKey: string) {
    this.shopId = shopId
    this.secretKey = secretKey
  }

  private get authHeader(): string {
    return `Basic ${btoa(`${this.shopId}:${this.secretKey}`)}`
  }

  private idempotenceKey(): string {
    return crypto.randomUUID()
  }

  async createPayment(
    amountRub: number,
    description: string,
    returnUrl: string,
    metadata: Record<string, string> = {}
  ): Promise<YukassaPayment> {
    const body: YukassaPaymentRequest = {
      amount: { value: (amountRub / 100).toFixed(2), currency: 'RUB' },
      confirmation: { type: 'redirect', return_url: returnUrl },
      capture: true,
      description,
      metadata
    }

    const resp = await fetch(`${this.baseUrl}/payments`, {
      method: 'POST',
      headers: {
        'Authorization': this.authHeader,
        'Content-Type': 'application/json',
        'Idempotence-Key': this.idempotenceKey()
      },
      body: JSON.stringify(body)
    })

    if (!resp.ok) {
      const err = await resp.text()
      throw new Error(`ЮKassa error ${resp.status}: ${err}`)
    }

    return resp.json() as Promise<YukassaPayment>
  }

  async getPayment(paymentId: string): Promise<YukassaPayment> {
    const resp = await fetch(`${this.baseUrl}/payments/${paymentId}`, {
      headers: { 'Authorization': this.authHeader }
    })

    if (!resp.ok) throw new Error(`ЮKassa get payment error: ${resp.status}`)
    return resp.json() as Promise<YukassaPayment>
  }

  async cancelPayment(paymentId: string): Promise<YukassaPayment> {
    const resp = await fetch(`${this.baseUrl}/payments/${paymentId}/cancel`, {
      method: 'POST',
      headers: {
        'Authorization': this.authHeader,
        'Content-Type': 'application/json',
        'Idempotence-Key': this.idempotenceKey()
      }
    })
    if (!resp.ok) throw new Error(`ЮKassa cancel error: ${resp.status}`)
    return resp.json() as Promise<YukassaPayment>
  }

  // Верификация webhook — ЮKassa шлёт IP из белого списка, дополнительно
  // можно проверять по payment_id через GET /payments/:id
  async verifyWebhook(body: string): Promise<YukassaPayment | null> {
    try {
      const event = JSON.parse(body)
      if (!event.object?.id) return null
      // Перепроверяем у ЮKassa (защита от фейковых вебхуков)
      return this.getPayment(event.object.id)
    } catch {
      return null
    }
  }
}
