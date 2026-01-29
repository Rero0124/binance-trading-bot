import {
  getAllBots,
  getBotById,
  createBot,
  updateBot,
  deleteBot,
  type BotConfig,
} from '@/lib/db';

export const runtime = 'nodejs';

type BotsConfig = {
  bots: BotConfig[];
};

function defaultBotConfig(id: string, name: string): BotConfig {
  return {
    id,
    name,
    enabled: false,
    market: 'spot',
    useTestnet: true,
    baseAsset: 'BTC',
    quoteAsset: 'USDT',
    interval: '1m',
    pollMs: 5000,
    dryRun: true,
    strategy: {
      type: 'ma_cross',
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
}

function migrateSymbolToAssets(bot: any): BotConfig {
  let baseAsset = bot.baseAsset;
  let quoteAsset = bot.quoteAsset;

  if (bot.symbol && (!baseAsset || !quoteAsset)) {
    const symbol = bot.symbol as string;

    if (symbol.endsWith('USDT')) {
      quoteAsset = 'USDT';
      baseAsset = symbol.replace('USDT', '');
    } else if (symbol.endsWith('BUSD')) {
      quoteAsset = 'BUSD';
      baseAsset = symbol.replace('BUSD', '');
    } else if (symbol.endsWith('BTC')) {
      quoteAsset = 'BTC';
      baseAsset = symbol.replace('BTC', '');
    } else {
      baseAsset = 'BTC';
      quoteAsset = 'USDT';
    }
  }

  if (!baseAsset) baseAsset = 'BTC';
  if (!quoteAsset) quoteAsset = 'USDT';

  const { symbol: _removed, ...rest } = bot;
  return { ...rest, baseAsset, quoteAsset } as BotConfig;
}

function readConfig(): BotsConfig {
  const bots = getAllBots();
  return { bots };
}

function validateBotConfig(bot: BotConfig): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (bot.risk.orderQuoteAmount < 10) {
    errors.push('주문 금액은 최소 10 USDT 이상이어야 합니다');
  }

  if (!bot.useTestnet && !bot.dryRun && bot.enabled) {
    errors.push(
      '실거래 모드는 드라이런을 먼저 해제할 수 없습니다. 안전을 위해 테스트넷에서 먼저 테스트하세요',
    );
  }

  if (bot.strategy.fastPeriod >= bot.strategy.slowPeriod) {
    errors.push('빠른 이동평균은 느린 이동평균보다 작아야 합니다');
  }

  if (bot.risk.stopLossPercent <= 0) {
    errors.push('손절 비율은 0보다 커야 합니다');
  }

  if (bot.risk.takeProfitPercent <= 0) {
    errors.push('익절 비율은 0보다 커야 합니다');
  }

  if (bot.position.cooldownCandles < 0) {
    errors.push('쿨다운 캔들 수는 0 이상이어야 합니다');
  }

  return { valid: errors.length === 0, errors };
}

export async function GET() {
  const config = readConfig();
  return Response.json(config);
}

export async function POST(request: Request) {
  const body = await request.json();
  const { action, botId } = body;

  if (action === 'create') {
    const config = readConfig();
    const newBot = defaultBotConfig(
      `bot-${Date.now()}`,
      body.name || `Bot ${config.bots.length + 1}`,
    );
    createBot(newBot);
    return Response.json(newBot);
  }

  if (action === 'delete' && botId) {
    deleteBot(botId);
    return Response.json({ success: true });
  }

  return Response.json({ error: 'Invalid action' }, { status: 400 });
}

export async function PUT(request: Request) {
  const body = await request.json();

  if (!body.bots || !Array.isArray(body.bots)) {
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const bots: BotConfig[] = body.bots.map(migrateSymbolToAssets);

  for (const bot of bots) {
    const existing = getBotById(bot.id);
    if (existing) {
      updateBot(bot);
    } else {
      createBot(bot);
    }
  }

  const config = readConfig();
  return Response.json(config);
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) {
    return Response.json({ error: 'Missing id' }, { status: 400 });
  }

  deleteBot(id);
  return Response.json({ success: true });
}
