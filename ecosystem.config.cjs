module.exports = {
  apps: [
    {
      name: 'mofidgame-server',
      script: 'node',
      args: '--loader tsx server.ts',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      restart_delay: 1500,
      exp_backoff_restart_delay: 200,
      max_restarts: 500,
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
    },
  ],
};
