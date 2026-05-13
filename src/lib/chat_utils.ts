// ============================================================
// Утилиты чата — вынесены отдельно чтобы избежать circular import.
// bookings.ts и payments.ts импортируют отсюда, НЕ из routes/chat.ts
// ============================================================

/**
 * Добавить системное (служебное) сообщение в чат записи.
 * sender_type = 'system', sender_id = 0.
 * Клиент и консультант видят его как серый центрированный блок.
 */
export async function addSystemChatMessage(
  db: D1Database,
  bookingId: number | string,
  body: string
): Promise<void> {
  try {
    await db
      .prepare(`
        INSERT INTO chat_messages (booking_id, sender_type, sender_id, body)
        VALUES (?, 'system', 0, ?)
      `)
      .bind(String(bookingId), body)
      .run()
  } catch (err) {
    console.error(`[chat_utils] addSystemChatMessage error bookingId=${bookingId}:`, err)
  }
}
