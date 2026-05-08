#!/bin/bash
# ============================================================
# Скрипт деплоя на VPS (запускать локально из папки проекта)
# Использование: bash deploy/deploy.sh
# ============================================================
set -e

VPS_IP="195.208.118.112"
VPS_USER="root"
APP_DIR="/var/www/antinarkologia"
ARCHIVE="/tmp/antinarkologia_deploy.tar.gz"

echo "=========================================="
echo "  Деплой АНТИНаркологии на VPS"
echo "  Сервер: ${VPS_USER}@${VPS_IP}"
echo "=========================================="

# ---- 1. Сборка ----
echo "[1/5] Сборка проекта..."
npm run build

# ---- 2. Архивация (без node_modules и .wrangler) ----
echo "[2/5] Создание архива..."
tar --exclude='./node_modules' \
    --exclude='./.wrangler' \
    --exclude='./.git' \
    --exclude='./deploy/*.tar.gz' \
    -czf ${ARCHIVE} .

echo "  Архив: ${ARCHIVE} ($(du -sh ${ARCHIVE} | cut -f1))"

# ---- 3. Загрузка на сервер ----
echo "[3/5] Загрузка на сервер..."
scp ${ARCHIVE} ${VPS_USER}@${VPS_IP}:/tmp/antinarkologia_deploy.tar.gz

# ---- 4. Установка на сервере ----
echo "[4/5] Установка на сервере..."
ssh ${VPS_USER}@${VPS_IP} bash << 'REMOTE'
set -e

APP_DIR="/var/www/antinarkologia"
ARCHIVE="/tmp/antinarkologia_deploy.tar.gz"

# Создаём директорию
mkdir -p ${APP_DIR}

# Распаковываем (перезаписываем всё кроме .env.production)
if [ -f "${APP_DIR}/.env.production" ]; then
    cp "${APP_DIR}/.env.production" /tmp/.env.production.bak
fi

tar -xzf ${ARCHIVE} -C ${APP_DIR}

if [ -f "/tmp/.env.production.bak" ]; then
    cp /tmp/.env.production.bak "${APP_DIR}/.env.production"
fi

# Устанавливаем зависимости
cd ${APP_DIR}
npm install --production=false

# Применяем миграции БД (SQLite local)
echo "Применение миграций БД..."
npx wrangler d1 migrations apply antinarkologia-production --local 2>/dev/null || true

echo "Файлы установлены успешно!"
REMOTE

# ---- 5. Перезапуск PM2 ----
echo "[5/5] Перезапуск сервиса..."
ssh ${VPS_USER}@${VPS_IP} bash << 'REMOTE'
cd /var/www/antinarkologia

# Если PM2 не запущен — стартуем
if pm2 list | grep -q "antinarkologia"; then
    pm2 reload antinarkologia
else
    pm2 start deploy/ecosystem.production.cjs
    pm2 save
    pm2 startup systemd -u root --hp /root | tail -1 | bash || true
fi

# Проверяем
sleep 3
curl -s http://localhost:3000/api/health || echo "WARN: health check не прошёл"
pm2 status antinarkologia
REMOTE

echo ""
echo "=========================================="
echo "  Деплой завершён!"
echo "  Проверка: https://antinarkologia.ru/api/health"
echo "=========================================="
