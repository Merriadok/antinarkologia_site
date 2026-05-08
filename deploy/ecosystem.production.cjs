// ============================================================
// PM2 конфиг для production VPS (antinarkologia.ru)
// Запуск: pm2 start deploy/ecosystem.production.cjs
// ============================================================
module.exports = {
  apps: [
    {
      name: 'antinarkologia',
      script: 'npx',
      args: 'wrangler pages dev dist --ip 0.0.0.0 --port 3000',
      cwd: '/var/www/antinarkologia',
      env_file: '/var/www/antinarkologia/.env.production',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      watch: false,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      log_file: '/var/log/antinarkologia/combined.log',
      out_file: '/var/log/antinarkologia/out.log',
      error_file: '/var/log/antinarkologia/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true
    }
  ]
}
