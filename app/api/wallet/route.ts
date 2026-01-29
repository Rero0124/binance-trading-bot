import fs from 'fs/promises';
import path from 'path';

export const runtime = 'nodejs';

const ROOT_DIR = process.cwd();
const DATA_DIR = path.join(ROOT_DIR, 'data');
const CONFIG_PATH = path.join(DATA_DIR, 'bot-config.json');

type WalletBalance = {
  asset: string;
  free: number;
  locked: number;
  total: number;
  usdValue?: number;
};

export async function GET() {
  try {
    const configRaw = await fs.readFile(CONFIG_PATH, 'utf8');
    const config = JSON.parse(configRaw);

    if (!config.bots || config.bots.length === 0) {
      return Response.json({ balances: [], error: 'No bots configured' });
    }

    const apiKey = process.env.BINANCE_API_KEY;
    const apiSecret = process.env.BINANCE_API_SECRET;

    if (!apiKey || !apiSecret) {
      return Response.json(
        {
          balances: [],
          error:
            'Mainnet API keys not configured. Please set BINANCE_API_KEY and BINANCE_API_SECRET in .env file',
        },
        { status: 400 },
      );
    }

    const firstBot = config.bots[0];
    const market = firstBot.market || 'spot';

    let baseUrl = '';
    if (market === 'futures') {
      baseUrl = 'https://fapi.binance.com';
    } else {
      baseUrl = 'https://api.binance.com';
    }

    const timestamp = Date.now();
    const crypto = await import('crypto');

    let endpoint = '';
    let queryString = `timestamp=${timestamp}`;

    if (market === 'futures') {
      endpoint = '/fapi/v2/account';
    } else {
      endpoint = '/api/v3/account';
    }

    const signature = crypto
      .createHmac('sha256', apiSecret)
      .update(queryString)
      .digest('hex');

    queryString += `&signature=${signature}`;

    const url = `${baseUrl}${endpoint}?${queryString}`;

    const response = await fetch(url, {
      headers: {
        'X-MBX-APIKEY': apiKey,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Wallet API] Error response:', errorText);
      return Response.json(
        {
          balances: [],
          error: `Binance API error: ${errorText}`,
        },
        { status: 500 },
      );
    }

    const data = await response.json();

    const balances: WalletBalance[] = [];

    if (market === 'futures') {
      if (data.assets && Array.isArray(data.assets)) {
        for (const asset of data.assets) {
          const free = Number(asset.availableBalance) || 0;
          const locked = Number(asset.initialMargin) || 0;
          const total = free + locked;

          if (total > 0) {
            balances.push({
              asset: asset.asset,
              free,
              locked,
              total,
            });
          }
        }
      }
    } else {
      if (data.balances && Array.isArray(data.balances)) {
        for (const balance of data.balances) {
          const free = Number(balance.free) || 0;
          const locked = Number(balance.locked) || 0;
          const total = free + locked;

          if (total > 0) {
            balances.push({
              asset: balance.asset,
              free,
              locked,
              total,
            });
          }
        }
      }
    }

    return Response.json({ balances, market });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
