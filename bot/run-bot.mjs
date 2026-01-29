import 'dotenv/config';
import crypto from 'crypto';
import { getAllBots, getBotById, updateBot, upsertBotState } from './db.mjs';

function nowIso() {
  return new Date().toISOString();
}

function getEnv(name, opts = {}) {
  const v = process.env[name];
  if ((v === undefined || v === '') && opts.required) {
    throw new Error(`Missing required env: ${name}`);
  }
  return v;
}

function toNumber(v, fallback) {
  if (v === undefined || v === null || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function signQuery(queryString, secret) {
  return crypto.createHmac('sha256', secret).update(queryString).digest('hex');
}

async function binanceRequest({
  baseUrl,
  path: apiPath,
  method,
  apiKey,
  apiSecret,
  query,
  bodyParams,
}) {
  const qs = new URLSearchParams(query || {});

  const isSigned = Boolean(apiSecret);

  if (isSigned && !qs.has('timestamp')) {
    qs.set('timestamp', String(Date.now()));
  }

  if (bodyParams) {
    for (const [k, v] of Object.entries(bodyParams)) {
      if (v === undefined || v === null) continue;
      qs.set(k, String(v));
    }
  }

  if (isSigned && apiSecret) {
    const signature = signQuery(qs.toString(), apiSecret);
    qs.set('signature', signature);
  }

  const url = `${baseUrl}${apiPath}?${qs.toString()}`;

  const headers = apiKey ? { 'X-MBX-APIKEY': apiKey } : undefined;
  const res = await fetch(url, { method, headers });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }

  if (!res.ok) {
    const err = new Error(`Binance API error ${res.status}: ${text}`);
    err.response = json;
    throw err;
  }

  return json;
}

async function getKlines({ baseUrl, market, symbol, interval, limit }) {
  const p = market === 'futures' ? '/fapi/v1/klines' : '/api/v3/klines';
  return binanceRequest({
    baseUrl,
    path: p,
    method: 'GET',
    apiKey: null,
    apiSecret: null,
    query: { symbol, interval, limit: String(limit) },
  });
}

function sma(values, period) {
  if (values.length < period) return null;
  const slice = values.slice(values.length - period);
  const sum = slice.reduce((a, b) => a + b, 0);
  return sum / period;
}

function roundStep(value, step) {
  if (!step || step <= 0) return value;
  const inv = 1 / step;
  return Math.floor(value * inv) / inv;
}

async function spotAccount({ baseUrl, apiKey, apiSecret }) {
  return binanceRequest({
    baseUrl,
    path: '/api/v3/account',
    method: 'GET',
    apiKey,
    apiSecret,
    query: {},
  });
}

async function futuresAccount({ baseUrl, apiKey, apiSecret }) {
  return binanceRequest({
    baseUrl,
    path: '/fapi/v2/account',
    method: 'GET',
    apiKey,
    apiSecret,
    query: {},
  });
}

async function futuresPositionRisk({ baseUrl, apiKey, apiSecret, symbol }) {
  return binanceRequest({
    baseUrl,
    path: '/fapi/v2/positionRisk',
    method: 'GET',
    apiKey,
    apiSecret,
    query: symbol ? { symbol } : {},
  });
}

async function futuresSetLeverage({
  baseUrl,
  apiKey,
  apiSecret,
  symbol,
  leverage,
}) {
  return binanceRequest({
    baseUrl,
    path: '/fapi/v1/leverage',
    method: 'POST',
    apiKey,
    apiSecret,
    query: {},
    bodyParams: {
      symbol,
      leverage,
    },
  });
}

async function spotOrder({ baseUrl, apiKey, apiSecret, params }) {
  return binanceRequest({
    baseUrl,
    path: '/api/v3/order',
    method: 'POST',
    apiKey,
    apiSecret,
    query: {},
    bodyParams: params,
  });
}

async function futuresOrder({ baseUrl, apiKey, apiSecret, params }) {
  return binanceRequest({
    baseUrl,
    path: '/fapi/v1/order',
    method: 'POST',
    apiKey,
    apiSecret,
    query: {},
    bodyParams: params,
  });
}

function computeSignal({ closes, fastPeriod, slowPeriod }) {
  const fast = sma(closes, fastPeriod);
  const slow = sma(closes, slowPeriod);
  if (fast === null || slow === null) return { signal: 'HOLD', fast, slow };
  if (fast > slow) return { signal: 'LONG', fast, slow };
  if (fast < slow) return { signal: 'SHORT', fast, slow };
  return { signal: 'HOLD', fast, slow };
}

function resolveBaseUrl({ market, useTestnet }) {
  if (market === 'futures') {
    return useTestnet
      ? 'https://testnet.binancefuture.com'
      : 'https://fapi.binance.com';
  }
  return useTestnet
    ? 'https://testnet.binance.vision'
    : 'https://api.binance.com';
}

function getSymbol(config) {
  if (config.symbol) {
    return config.symbol;
  }
  if (config.baseAsset && config.quoteAsset) {
    const symbol = config.baseAsset + config.quoteAsset;
    return symbol;
  }
  return 'BTCUSDT';
}

function defaultBotConfig(id, name) {
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

function defaultConfig() {
  return {
    bots: [defaultBotConfig('bot-1', 'Bot 1')],
  };
}

const botRuntimeData = new Map();

function initBotRuntime(botId) {
  if (!botRuntimeData.has(botId)) {
    botRuntimeData.set(botId, {
      lastOrderCandle: 0,
      candleCount: 0,
      dailyLoss: 0,
      totalLoss: 0,
      dailyResetTime: Date.now(),
    });
  }
  return botRuntimeData.get(botId);
}

function checkStopLossTakeProfit(position, config) {
  if (!position || !config.risk) return null;

  const positionAmt = Math.abs(Number(position.positionAmt) || 0);
  if (positionAmt === 0) return null;

  const entryPrice = Number(position.entryPrice) || 0;
  const markPrice = Number(position.markPrice) || entryPrice;
  if (entryPrice === 0 || markPrice === 0) return null;

  const pnlPercent = ((markPrice - entryPrice) / entryPrice) * 100;
  const isLong = Number(position.positionAmt) > 0;
  const actualPnl = isLong ? pnlPercent : -pnlPercent;

  const stopLoss = config.risk.stopLossPercent || 1.0;
  const takeProfit = config.risk.takeProfitPercent || 1.5;

  if (actualPnl <= -stopLoss) {
    return { action: 'CLOSE', reason: 'STOP_LOSS', pnl: actualPnl };
  }

  if (actualPnl >= takeProfit) {
    return { action: 'CLOSE', reason: 'TAKE_PROFIT', pnl: actualPnl };
  }

  return null;
}

function checkMaxLoss(runtime, config, walletBalance) {
  if (!config.risk) return { allowed: true };

  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  if (now - runtime.dailyResetTime > dayMs) {
    runtime.dailyLoss = 0;
    runtime.dailyResetTime = now;
  }

  const maxDailyPercent = config.risk.maxDailyLossPercent || 5.0;
  const maxTotalPercent = config.risk.maxTotalLossPercent || 10.0;

  const maxDailyUSDT = (walletBalance * maxDailyPercent) / 100;
  const maxTotalUSDT = (walletBalance * maxTotalPercent) / 100;

  if (runtime.dailyLoss >= maxDailyUSDT) {
    return {
      allowed: false,
      reason: 'MAX_DAILY_LOSS',
      lossUSDT: runtime.dailyLoss,
      limitUSDT: maxDailyUSDT,
    };
  }

  if (runtime.totalLoss >= maxTotalUSDT) {
    return {
      allowed: false,
      reason: 'MAX_TOTAL_LOSS',
      lossUSDT: runtime.totalLoss,
      limitUSDT: maxTotalUSDT,
    };
  }

  return { allowed: true };
}

function checkCooldown(runtime, config) {
  if (!config.position) return true;

  const cooldown = config.position.cooldownCandles || 0;
  if (cooldown === 0) return true;

  const candlesSinceOrder = runtime.candleCount - runtime.lastOrderCandle;
  return candlesSinceOrder >= cooldown;
}

function updateVirtualBalance(config, side, qty, price) {
  if (!config.virtualBalance) {
    config.virtualBalance = {
      initialQuoteBalance: 1000,
      currentQuoteBalance: 1000,
      currentBaseBalance: 0,
    };
  }

  const vb = config.virtualBalance;

  if (side === 'BUY') {
    const cost = qty * price;
    vb.currentQuoteBalance -= cost;
    vb.currentBaseBalance += qty;
  } else if (side === 'SELL') {
    const proceeds = qty * price;
    vb.currentQuoteBalance += proceeds;
    vb.currentBaseBalance -= qty;
  }

  return vb;
}

async function runBot(botConfig, apiKey, apiSecret) {
  const botId = botConfig.id;
  let lastDecision = null;
  const runtime = initBotRuntime(botId);

  while (true) {
    const startedAt = Date.now();

    // Check for config updates at the start of each loop
    const updatedBot = getBotById(botId);
    if (updatedBot) {
      const oldEnabled = botConfig.enabled;
      const newEnabled = updatedBot.enabled;

      // Update all properties of the config object
      for (const key in botConfig) {
        if (!(key in updatedBot)) {
          delete botConfig[key];
        }
      }
      for (const key in updatedBot) {
        botConfig[key] = updatedBot[key];
      }

      if (oldEnabled !== newEnabled) {
        console.log(
          `[Bot ${botId}] enabled changed: ${oldEnabled} -> ${newEnabled}`,
        );
      }
    } else {
      console.log(`[Bot ${botId}] WARNING: getBotById returned null`);
    }

    let state = {
      botId,
      updatedAt: nowIso(),
      ok: true,
      error: null,
      lastDecision,
    };

    try {
      const config = botConfig;
      const market = config.market === 'futures' ? 'futures' : 'spot';
      const useTestnet = Boolean(config.useTestnet);
      const baseUrl = resolveBaseUrl({ market, useTestnet });

      const symbol = getSymbol(config);

      state.config = {
        enabled: Boolean(config.enabled),
        market,
        useTestnet,
        symbol,
        interval: config.interval,
        pollMs: config.pollMs,
        dryRun: Boolean(config.dryRun),
        strategy: config.strategy,
        risk: config.risk,
      };

      if (!config.enabled) {
        state.status = 'DISABLED';
        upsertBotState(state);
        await sleep(Math.max(500, toNumber(config.pollMs, 5000)));
        continue;
      }

      runtime.candleCount++;

      const klines = await getKlines({
        baseUrl,
        market,
        symbol,
        interval: config.interval,
        limit: 200,
      });

      const closes = klines
        .map((k) => Number(k[4]))
        .filter((n) => Number.isFinite(n));
      const strat = config.strategy || {};
      const fastPeriod = Math.max(1, toNumber(strat.fastPeriod, 9));
      const slowPeriod = Math.max(
        fastPeriod + 1,
        toNumber(strat.slowPeriod, 21),
      );

      const { signal, fast, slow } = computeSignal({
        closes,
        fastPeriod,
        slowPeriod,
      });

      state.marketData = {
        lastClose: closes[closes.length - 1],
        fast,
        slow,
        signal,
      };

      if (market === 'futures') {
        let decision = null;

        const leverage = Math.max(
          1,
          Math.min(125, toNumber(config.risk?.leverage, 3)),
        );
        await futuresSetLeverage({
          baseUrl,
          apiKey,
          apiSecret,
          symbol,
          leverage,
        });

        const account = await futuresAccount({ baseUrl, apiKey, apiSecret });
        const positions = await futuresPositionRisk({
          baseUrl,
          apiKey,
          apiSecret,
          symbol,
        });
        const pos = Array.isArray(positions) ? positions[0] : null;

        const positionAmt = pos ? Number(pos.positionAmt) : 0;
        const entryPrice = pos ? Number(pos.entryPrice) : 0;
        const markPrice = pos ? Number(pos.markPrice) : null;
        const unrealizedProfit = pos ? Number(pos.unRealizedProfit) : null;
        const walletBalance = Number(account.totalWalletBalance);

        state.account = {
          totalWalletBalance: walletBalance,
          totalUnrealizedProfit: Number(account.totalUnrealizedProfit),
        };

        state.position = {
          symbol,
          positionAmt,
          entryPrice,
          markPrice,
          unrealizedProfit,
        };

        const lossCheck = checkMaxLoss(runtime, config, walletBalance);
        if (!lossCheck.allowed) {
          state.status = 'BLOCKED';
          state.error = {
            message: `최대 손실 도달: ${lossCheck.reason} (${lossCheck.lossUSDT.toFixed(2)} USDT / ${lossCheck.limitUSDT.toFixed(2)} USDT)`,
          };
          upsertBotState(state);
          await sleep(Math.max(500, toNumber(config.pollMs, 5000)));
          continue;
        }

        const slTpCheck = checkStopLossTakeProfit(state.position, config);
        if (slTpCheck && Math.abs(positionAmt) > 0) {
          const closeSide = positionAmt > 0 ? 'SELL' : 'BUY';
          const closeQty = Math.abs(positionAmt);

          decision = {
            action: config.dryRun
              ? `DRY_CLOSE_${slTpCheck.reason}`
              : `CLOSE_${slTpCheck.reason}`,
            reason: slTpCheck.reason,
            qty: closeQty,
            pnl: slTpCheck.pnl,
          };

          if (!config.dryRun) {
            await futuresOrder({
              baseUrl,
              apiKey,
              apiSecret,
              params: {
                symbol,
                side: closeSide,
                type: 'MARKET',
                quantity: closeQty,
                reduceOnly: true,
              },
            });
          }

          runtime.lastOrderCandle = runtime.candleCount;

          const lossUSDT = Math.abs(unrealizedProfit || 0);
          if (slTpCheck.pnl < 0) {
            runtime.dailyLoss += lossUSDT;
            runtime.totalLoss += lossUSDT;
          }
        } else {
          const quoteAmount = Math.max(
            0,
            toNumber(config.risk?.orderQuoteAmount, 20),
          );
          const lastPrice = closes[closes.length - 1];
          const rawQty = lastPrice > 0 ? quoteAmount / lastPrice : 0;
          const stepSize = toNumber(config.risk?.quantityStep, 0.0001);
          const qty = roundStep(rawQty, stepSize);

          const minQty = stepSize;
          const minNotional = 5;
          const notionalValue = qty * lastPrice;

          const qtyValid = qty >= minQty && notionalValue >= minNotional;

          decision = {
            action: 'NONE',
            reason: 'HOLD',
            qty,
            signal,
            lastPrice,
          };

          const hasPosition = Math.abs(positionAmt) > 0;
          const preventDuplicate =
            config.position?.preventDuplicateOrders ?? true;
          const canOrder = !hasPosition || !preventDuplicate;
          const cooldownOk = checkCooldown(runtime, config);

          if (qtyValid && canOrder && cooldownOk) {
            if (signal === 'LONG' && positionAmt <= 0) {
              decision = {
                action: config.dryRun ? 'DRY_BUY' : 'BUY',
                reason: 'MA_CROSS',
                qty,
                signal,
              };
              if (!config.dryRun) {
                await futuresOrder({
                  baseUrl,
                  apiKey,
                  apiSecret,
                  params: {
                    symbol,
                    side: 'BUY',
                    type: 'MARKET',
                    quantity: qty,
                  },
                });
              }
              runtime.lastOrderCandle = runtime.candleCount;
            } else if (signal === 'SHORT' && positionAmt >= 0) {
              decision = {
                action: config.dryRun ? 'DRY_SELL' : 'SELL',
                reason: 'MA_CROSS',
                qty,
                signal,
              };
              if (!config.dryRun) {
                await futuresOrder({
                  baseUrl,
                  apiKey,
                  apiSecret,
                  params: {
                    symbol,
                    side: 'SELL',
                    type: 'MARKET',
                    quantity: qty,
                  },
                });
              }
              runtime.lastOrderCandle = runtime.candleCount;
            }
          } else if (!qtyValid) {
            decision.reason = 'QTY_INVALID';
          } else if (!cooldownOk) {
            decision.reason = 'COOLDOWN';
          } else if (hasPosition && preventDuplicate) {
            decision.reason = 'POSITION_EXISTS';
          }
        }

        lastDecision = { ...decision, at: nowIso() };
        state.lastDecision = lastDecision;
        state.status = 'RUNNING';
      } else {
        const quoteAsset = config.quoteAsset || 'USDT';
        const baseAsset = config.baseAsset || 'BTC';
        const lastPrice = closes[closes.length - 1];

        let baseFree, quoteFree, estValueQuote;

        if (config.dryRun) {
          if (!config.virtualBalance) {
            config.virtualBalance = {
              initialQuoteBalance: 1000,
              currentQuoteBalance: 1000,
              currentBaseBalance: 0,
            };
          }

          baseFree = config.virtualBalance.currentBaseBalance;
          quoteFree = config.virtualBalance.currentQuoteBalance;
          estValueQuote = baseFree * lastPrice;

          const totalValue = quoteFree + estValueQuote;
          const profitLoss =
            totalValue - config.virtualBalance.initialQuoteBalance;
          const profitLossPercent =
            (profitLoss / config.virtualBalance.initialQuoteBalance) * 100;

          state.account = {
            quoteAsset,
            quoteFree,
            virtual: true,
            initialBalance: config.virtualBalance.initialQuoteBalance,
            totalValue,
            profitLoss,
            profitLossPercent,
          };
        } else {
          const account = await spotAccount({ baseUrl, apiKey, apiSecret });
          const quoteBal = quoteAsset
            ? account.balances.find((b) => b.asset === quoteAsset)
            : null;
          const baseBal = baseAsset
            ? account.balances.find((b) => b.asset === baseAsset)
            : null;

          baseFree = baseBal ? Number(baseBal.free) : null;
          quoteFree = quoteBal ? Number(quoteBal.free) : null;
          estValueQuote =
            baseFree !== null && Number.isFinite(lastPrice)
              ? baseFree * lastPrice
              : null;

          state.account = {
            quoteAsset,
            quoteFree,
            virtual: false,
          };
        }

        state.position = {
          symbol,
          baseAsset,
          baseFree,
          quoteAsset,
          quoteFree,
          lastPrice,
          estValueQuote,
        };

        const quoteAmount = Math.max(
          0,
          toNumber(config.risk?.orderQuoteAmount, 20),
        );
        const rawQty = lastPrice > 0 ? quoteAmount / lastPrice : 0;
        const qty = roundStep(
          rawQty,
          toNumber(config.risk?.quantityStep, 0.0001),
        );

        let decision = {
          action: 'NONE',
          reason: 'HOLD',
          qty,
          signal,
          lastPrice,
        };

        if (qty > 0) {
          if (signal === 'LONG') {
            decision = {
              action: config.dryRun ? 'DRY_BUY' : 'BUY',
              reason: 'MA_CROSS',
              qty,
              signal,
            };
            if (config.dryRun) {
              updateVirtualBalance(config, 'BUY', qty, lastPrice);
            } else {
              await spotOrder({
                baseUrl,
                apiKey,
                apiSecret,
                params: {
                  symbol,
                  side: 'BUY',
                  type: 'MARKET',
                  quantity: qty,
                },
              });
            }
          } else if (signal === 'SHORT') {
            decision = {
              action: config.dryRun ? 'DRY_SELL' : 'SELL',
              reason: 'MA_CROSS',
              qty,
              signal,
            };
            if (config.dryRun) {
              updateVirtualBalance(config, 'SELL', qty, lastPrice);
            } else {
              await spotOrder({
                baseUrl,
                apiKey,
                apiSecret,
                params: {
                  symbol,
                  side: 'SELL',
                  type: 'MARKET',
                  quantity: qty,
                },
              });
            }
          }
        }

        lastDecision = { ...decision, at: nowIso() };
        state.lastDecision = lastDecision;
        state.status = 'RUNNING';
      }

      upsertBotState(state);

      if (botConfig.dryRun && botConfig.virtualBalance) {
        updateBot(botConfig);
      }
    } catch (e) {
      state.ok = false;
      state.status = 'ERROR';
      state.error = {
        message: e?.message || String(e),
        response: e?.response || null,
      };
      upsertBotState(state);
    }

    const pollMs = Math.max(500, toNumber(botConfig.pollMs, 5000));
    const elapsed = Date.now() - startedAt;
    await sleep(Math.max(0, pollMs - elapsed));
  }
}

async function main() {
  const mainnetApiKey = getEnv('BINANCE_API_KEY', { required: false });
  const mainnetApiSecret = getEnv('BINANCE_API_SECRET', { required: false });
  const testnetApiKey = getEnv('TEST_BINANCE_API_KEY', { required: false });
  const testnetApiSecret = getEnv('TEST_BINANCE_API_SECRET', {
    required: false,
  });

  if (!mainnetApiKey && !testnetApiKey) {
    throw new Error(
      'At least one set of API keys required: BINANCE_API_KEY/SECRET or TEST_BINANCE_API_KEY/SECRET',
    );
  }

  const runningBots = new Map();

  function syncBots() {
    const bots = getAllBots();

    for (const bot of bots) {
      if (!runningBots.has(bot.id)) {
        const botConfigCopy = JSON.parse(JSON.stringify(bot));
        const useTestnet = Boolean(botConfigCopy.useTestnet);

        const apiKey = useTestnet ? testnetApiKey : mainnetApiKey;
        const apiSecret = useTestnet ? testnetApiSecret : mainnetApiSecret;

        if (!apiKey || !apiSecret) {
          console.error(
            `Bot ${bot.id}: Missing ${useTestnet ? 'testnet' : 'mainnet'} API keys`,
          );
          continue;
        }

        runningBots.set(bot.id, true);
        runBot(botConfigCopy, apiKey, apiSecret).catch((e) => {
          console.error(`Bot ${bot.id} crashed:`, e);
          runningBots.delete(bot.id);
        });
      }
    }

    const currentIds = new Set(bots.map((b) => b.id));
    for (const [id] of runningBots) {
      if (!currentIds.has(id)) {
        runningBots.delete(id);
      }
    }
  }

  syncBots();
  setInterval(() => {
    try {
      syncBots();
    } catch (e) {
      console.error('syncBots error:', e);
    }
  }, 10000);
}

main().catch((e) => {
  console.error('Main process error:', e);
  upsertBotState({
    botId: 'main',
    updatedAt: nowIso(),
    ok: false,
    status: 'FATAL',
    error: { message: e?.message || String(e) },
  });
  process.exitCode = 1;
});
