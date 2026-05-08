#!/bin/bash
# ============================================================
# АНТИНаркология — установка на чистый Ubuntu VPS
# Запускать от root: bash setup_vps.sh
# ============================================================
set -e

echo "=========================================="
echo "  АНТИНаркология VPS Setup"
echo "  Ubuntu 26.04 — Node.js 20 + nginx + PM2"
echo "=========================================="

# ---- 1. Обновление системы ----
echo "[1/8] Обновление системы..."
apt-get update -q
apt-get upgrade -y -q

# ---- 2. Базовые утилиты ----
echo "[2/8] Установка базовых утилит..."
apt-get install -y -q curl wget git unzip build-essential ca-certificates gnupg lsb-release sqlite3

# ---- 3. Node.js 20 LTS (через NodeSource) ----
echo "[3/8] Установка Node.js 20 LTS..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
node --version
npm --version

# ---- 4. PM2 (глобально) ----
echo "[4/8] Установка PM2..."
npm install -g pm2
pm2 --version

# ---- 5. nginx ----
echo "[5/8] Установка nginx..."
apt-get install -y nginx
systemctl enable nginx
systemctl start nginx

# ---- 6. Certbot (Let's Encrypt SSL) ----
echo "[6/8] Установка certbot..."
apt-get install -y certbot python3-certbot-nginx

# ---- 7. Настройка файрволла ----
echo "[7/8] Настройка UFW (файрволл)..."
apt-get install -y ufw
ufw allow ssh
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
ufw status

# ---- 8. Создание директорий ----
echo "[8/8] Создание директорий приложения..."
mkdir -p /var/www/antinarkologia
mkdir -p /var/log/antinarkologia

echo ""
echo "=========================================="
echo "  Базовая установка завершена!"
echo ""
echo "  Следующие шаги:"
echo "  1. Загрузить архив: scp antinarkologia.tar.gz root@SERVER:/tmp/"
echo "  2. Распаковать:     tar -xzf /tmp/antinarkologia.tar.gz -C /var/www/"
echo "  3. Установить зависимости: cd /var/www/antinarkologia && npm install && npm run build"
echo "  4. Создать .env:    nano /var/www/antinarkologia/.env.production"
echo "  5. Запустить PM2:   pm2 start /var/www/antinarkologia/deploy/ecosystem.production.cjs"
echo "  6. Настроить nginx: cp /var/www/antinarkologia/deploy/nginx.conf /etc/nginx/sites-available/antinarkologia"
echo "  7. SSL:             certbot --nginx -d antinarkologia.ru -d www.antinarkologia.ru"
echo "=========================================="
