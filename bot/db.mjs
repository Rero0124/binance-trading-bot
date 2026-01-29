import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DB_PATH = path.join(ROOT_DIR, 'data', 'trading-bot.db');

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

export function getAllBots() {
  const rows = db.prepare('SELECT * FROM bots ORDER BY created_at').all();
  return rows.map(rowToBot);
}

export function getBotById(id) {
  const row = db.prepare('SELECT * FROM bots WHERE id = ?').get(id);
  return row ? rowToBot(row) : null;
}

export function updateBot(bot) {
  const stmt = db.prepare(`
    UPDATE bots SET
      name = ?, enabled = ?, market = ?, use_testnet = ?, base_asset = ?,
      quote_asset = ?, interval = ?, poll_ms = ?, dry_run = ?,
      strategy_type = ?, strategy_fast_period = ?, strategy_slow_period = ?,
      risk_order_quote_amount = ?, risk_leverage = ?, risk_quantity_step = ?,
      risk_stop_loss_percent = ?, risk_take_profit_percent = ?,
      risk_max_daily_loss_percent = ?, risk_max_total_loss_percent = ?,
      position_prevent_duplicate_orders = ?, position_cooldown_candles = ?,
      virtual_balance_initial = ?, virtual_balance_current_quote = ?,
      virtual_balance_current_base = ?, updated_at = datetime('now')
    WHERE id = ?
  `);

  stmt.run(
    bot.name,
    bot.enabled ? 1 : 0,
    bot.market,
    bot.useTestnet ? 1 : 0,
    bot.baseAsset,
    bot.quoteAsset,
    bot.interval,
    bot.pollMs,
    bot.dryRun ? 1 : 0,
    bot.strategy.type,
    bot.strategy.fastPeriod,
    bot.strategy.slowPeriod,
    bot.risk.orderQuoteAmount,
    bot.risk.leverage,
    bot.risk.quantityStep,
    bot.risk.stopLossPercent,
    bot.risk.takeProfitPercent,
    bot.risk.maxDailyLossPercent,
    bot.risk.maxTotalLossPercent,
    bot.position.preventDuplicateOrders ? 1 : 0,
    bot.position.cooldownCandles,
    bot.virtualBalance?.initialQuoteBalance || null,
    bot.virtualBalance?.currentQuoteBalance || null,
    bot.virtualBalance?.currentBaseBalance || null,
    bot.id,
  );
}

export function insertProfitHistory(data) {
  const stmt = db.prepare(`
    INSERT INTO profit_history (bot_id, profit, balance, position_size, entry_price)
    VALUES (?, ?, ?, ?, ?)
  `);

  stmt.run(
    data.botId,
    data.profit,
    data.balance || null,
    data.positionSize || null,
    data.entryPrice || null,
  );
}

export function getProfitHistory(botId, limit = 100) {
  const rows = db
    .prepare(
      `SELECT timestamp, profit, balance FROM profit_history 
       WHERE bot_id = ? 
       ORDER BY timestamp DESC 
       LIMIT ?`,
    )
    .all(botId, limit);

  return rows
    .map((row) => ({
      timestamp: row.timestamp,
      profit: row.profit,
      balance: row.balance,
    }))
    .reverse();
}

export function getTotalProfitHistory(limit = 100) {
  const rows = db
    .prepare(
      `SELECT timestamp, SUM(profit) as total_profit 
       FROM profit_history 
       WHERE bot_id IN (
         SELECT id FROM bots WHERE dry_run = 0 AND use_testnet = 0
       )
       GROUP BY timestamp 
       ORDER BY timestamp DESC 
       LIMIT ?`,
    )
    .all(limit);

  return rows
    .map((row) => ({
      timestamp: row.timestamp,
      profit: row.total_profit,
    }))
    .reverse();
}

export function getTotalWalletHistory(limit = 100) {
  const rows = db
    .prepare(
      `SELECT timestamp, total_profit as profit 
       FROM wallet_history 
       ORDER BY timestamp DESC 
       LIMIT ?`,
    )
    .all(limit);

  return rows
    .map((row) => ({
      timestamp: row.timestamp,
      profit: row.profit,
    }))
    .reverse();
}

export function insertWalletHistory(data) {
  const stmt = db.prepare(`
    INSERT INTO wallet_history (total_profit, total_balance, active_bots)
    VALUES (?, ?, ?)
  `);

  stmt.run(
    data.totalProfit,
    data.totalBalance || null,
    data.activeBots || null,
  );
}

export function deleteBotProfitHistory(botId) {
  db.prepare('DELETE FROM profit_history WHERE bot_id = ?').run(botId);
}

export function upsertBotState(state) {
  const stmt = db.prepare(`
    INSERT INTO bot_states (
      bot_id, updated_at, ok, status, error_message, config,
      market_data, account, position, last_decision
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(bot_id) DO UPDATE SET
      updated_at = excluded.updated_at,
      ok = excluded.ok,
      status = excluded.status,
      error_message = excluded.error_message,
      config = excluded.config,
      market_data = excluded.market_data,
      account = excluded.account,
      position = excluded.position,
      last_decision = excluded.last_decision
  `);

  stmt.run(
    state.botId,
    state.updatedAt,
    state.ok ? 1 : 0,
    state.status,
    state.error?.message || null,
    state.config ? JSON.stringify(state.config) : null,
    state.marketData ? JSON.stringify(state.marketData) : null,
    state.account ? JSON.stringify(state.account) : null,
    state.position ? JSON.stringify(state.position) : null,
    state.lastDecision ? JSON.stringify(state.lastDecision) : null,
  );
}

function rowToBot(row) {
  return {
    id: row.id,
    name: row.name,
    enabled: Boolean(row.enabled),
    market: row.market,
    useTestnet: Boolean(row.use_testnet),
    baseAsset: row.base_asset,
    quoteAsset: row.quote_asset,
    interval: row.interval,
    pollMs: row.poll_ms,
    dryRun: Boolean(row.dry_run),
    strategy: {
      type: row.strategy_type,
      fastPeriod: row.strategy_fast_period,
      slowPeriod: row.strategy_slow_period,
    },
    risk: {
      orderQuoteAmount: row.risk_order_quote_amount,
      leverage: row.risk_leverage,
      quantityStep: row.risk_quantity_step,
      stopLossPercent: row.risk_stop_loss_percent,
      takeProfitPercent: row.risk_take_profit_percent,
      maxDailyLossPercent: row.risk_max_daily_loss_percent,
      maxTotalLossPercent: row.risk_max_total_loss_percent,
    },
    position: {
      preventDuplicateOrders: Boolean(row.position_prevent_duplicate_orders),
      cooldownCandles: row.position_cooldown_candles,
    },
    virtualBalance: row.virtual_balance_initial
      ? {
          initialQuoteBalance: row.virtual_balance_initial,
          currentQuoteBalance: row.virtual_balance_current_quote,
          currentBaseBalance: row.virtual_balance_current_base,
        }
      : undefined,
  };
}

export default db;
