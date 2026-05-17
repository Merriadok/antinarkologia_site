module.exports = {
  apps: [
    {
      name: 'antinarkologia',
      script: 'npx',
      args: 'wrangler pages dev dist --d1=antinarkologia-production --local --ip 0.0.0.0 --port 3000',
      env: {
        NODE_ENV: 'development',
        PORT: 3000
      },
      watch: false,
      instances: 1,
      exec_mode: 'fork',
      // Убиваем дочерние процессы (workerd) перед рестартом
      // Без этого workerd продолжает держать порт 3000 после restart
      kill_timeout: 5000,
      // Скрипт перед стартом — освобождаем порт от зомби-workerd
      pre_start: 'fuser -k 3000/tcp 2>/dev/null || true',
      // Не рестартовать слишком быстро — даём время на cleanup
      restart_delay: 3000,
      // Максимум рестартов за 60 сек перед тем как PM2 остановит процесс
      max_restarts: 5,
      min_uptime: '10s'
    }
  ]
}
