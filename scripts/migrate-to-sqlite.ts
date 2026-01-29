import fs from 'fs';
import path from 'path';
import { getAllBots, createBot, closeDatabase } from '../lib/db';

const CONFIG_PATH = path.join(process.cwd(), 'data', 'bot-config.json');

async function migrate() {
  console.log('Starting migration from JSON to SQLite...');

  // Check if bots already exist in DB
  const existingBots = getAllBots();
  if (existingBots.length > 0) {
    console.log(`Database already has ${existingBots.length} bots. Skipping migration.`);
    closeDatabase();
    return;
  }

  // Read JSON config
  if (!fs.existsSync(CONFIG_PATH)) {
    console.log('No bot-config.json found. Creating default bot...');
    const defaultBot = {
      id: 'bot-1',
      name: 'Bot 1',
      enabled: false,
      market: 'spot' as const,
      useTestnet: true,
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      interval: '1m',
      pollMs: 5000,
      dryRun: true,
      strategy: {
        type: 'ma_cross' as const,
        fastPeriod: 9,
        slowPeriod: 21,
      },
      risk: {
        orderQuoteAmount: 20,
        leverage: 3,
        quantityStep: 0.0001,
        stopLossPercent: 1.0,
        takeProfitPercent: 1.5,
        maxDailyLossPercent: 5.0,
        maxTotalLossPercent: 10.0,
      },
      position: {
        preventDuplicateOrders: true,
        cooldownCandles: 3,
      },
      virtualBalance: {
        initialQuoteBalance: 1000,
        currentQuoteBalance: 1000,
        currentBaseBalance: 0,
      },
    };
    createBot(defaultBot);
    console.log('Created default bot.');
    closeDatabase();
    return;
  }

  const configRaw = fs.readFileSync(CONFIG_PATH, 'utf8');
  const config = JSON.parse(configRaw);

  if (!config.bots || !Array.isArray(config.bots)) {
    console.log('Invalid config format. Skipping migration.');
    closeDatabase();
    return;
  }

  console.log(`Found ${config.bots.length} bots in JSON config.`);

  for (const bot of config.bots) {
    // Ensure all required fields exist
    const migratedBot = {
      id: bot.id || `bot-${Date.now()}`,
      name: bot.name || 'Unnamed Bot',
      enabled: Boolean(bot.enabled),
      market: bot.market || 'spot',
      useTestnet: Boolean(bot.useTestnet ?? true),
      baseAsset: bot.baseAsset || 'BTC',
      quoteAsset: bot.quoteAsset || 'USDT',
      interval: bot.interval || '1m',
      pollMs: bot.pollMs || 5000,
      dryRun: Boolean(bot.dryRun ?? true),
      strategy: {
        type: 'ma_cross' as const,
        fastPeriod: bot.strategy?.fastPeriod || 9,
        slowPeriod: bot.strategy?.slowPeriod || 21,
      },
      risk: {
        orderQuoteAmount: bot.risk?.orderQuoteAmount || 20,
        leverage: bot.risk?.leverage || 3,
        quantityStep: bot.risk?.quantityStep || 0.0001,
        stopLossPercent: bot.risk?.stopLossPercent || 1.0,
        takeProfitPercent: bot.risk?.takeProfitPercent || 1.5,
        maxDailyLossPercent: bot.risk?.maxDailyLossPercent || 5.0,
        maxTotalLossPercent: bot.risk?.maxTotalLossPercent || 10.0,
      },
      position: {
        preventDuplicateOrders: Boolean(bot.position?.preventDuplicateOrders ?? true),
        cooldownCandles: bot.position?.cooldownCandles || 3,
      },
      virtualBalance: bot.virtualBalance
        ? {
            initialQuoteBalance: bot.virtualBalance.initialQuoteBalance || 1000,
            currentQuoteBalance: bot.virtualBalance.currentQuoteBalance || 1000,
            currentBaseBalance: bot.virtualBalance.currentBaseBalance || 0,
          }
        : {
            initialQuoteBalance: 1000,
            currentQuoteBalance: 1000,
            currentBaseBalance: 0,
          },
    };

    createBot(migratedBot);
    console.log(`Migrated bot: ${migratedBot.id} (${migratedBot.name})`);
  }

  console.log('Migration completed successfully!');
  closeDatabase();
}

migrate().catch((error) => {
  console.error('Migration failed:', error);
  closeDatabase();
  process.exit(1);
});
