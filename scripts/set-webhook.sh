#!/bin/bash
# ============================================================
# set-webhook.sh — регистрирует Telegram webhook
#
# Использование:
#   ./scripts/set-webhook.sh
#   # или на VPS: cd /var/www/antinarkologia && bash scripts/set-webhook.sh
#
# Читает токены из .dev.vars (не из env — для безопасности)
# Использует прокси-воркер + явный ip_address чтобы обойти
# блокировку api.telegram.org и DNS-проблемы хостера.
# ============================================================

set -e

VARS_FILE="${1:-.dev.vars}"
TG_PROXY="https://tg-proxy-antinarkologia.trade-merry.workers.dev"
VPS_IP="195.208.118.112"
WEBHOOK_BASE="https://new.antinarkologia.ru"

# Читаем переменные
if [ ! -f "$VARS_FILE" ]; then
  echo "❌ Файл $VARS_FILE не найден"
  exit 1
fi

BOT_TOKEN=$(grep "^TELEGRAM_BOT_TOKEN=" "$VARS_FILE" | cut -d= -f2)
BOT_SECRET=$(grep "^TELEGRAM_BOT_SECRET=" "$VARS_FILE" | cut -d= -f2)

if [ -z "$BOT_TOKEN" ]; then
  echo "❌ TELEGRAM_BOT_TOKEN не найден в $VARS_FILE"
  exit 1
fi

WEBHOOK_URL="${WEBHOOK_BASE}/api/telegram/webhook"

echo "🔄 Регистрируем webhook..."
echo "   URL: $WEBHOOK_URL"
echo "   IP:  $VPS_IP"
echo "   Прокси: $TG_PROXY"

# Сбрасываем накопившуюся очередь и ставим webhook заново
RESULT=$(curl -sf --max-time 15 "${TG_PROXY}/bot${BOT_TOKEN}/setWebhook" \
  -d "url=${WEBHOOK_URL}" \
  -d "secret_token=${BOT_SECRET}" \
  -d "allowed_updates=[\"message\"]" \
  -d "ip_address=${VPS_IP}" \
  -d "drop_pending_updates=true")

echo "📡 Ответ Telegram: $RESULT"

if echo "$RESULT" | grep -q '"ok":true'; then
  echo "✅ Webhook установлен успешно!"
else
  echo "❌ Ошибка при установке webhook"
  exit 1
fi

# Проверяем
echo ""
echo "📊 Текущее состояние webhook:"
curl -sf --max-time 10 "${TG_PROXY}/bot${BOT_TOKEN}/getWebhookInfo" | python3 -m json.tool 2>/dev/null || \
  curl -sf --max-time 10 "${TG_PROXY}/bot${BOT_TOKEN}/getWebhookInfo"
