module.exports = {
  apps: [
    {
      name: 'binance-bot',
      script: 'bot/run-bot.mjs',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
