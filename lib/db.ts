import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_PATH = path.join(process.cwd(), 'data', 'trading-bot.db');

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent access
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS bots (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0,
    market TEXT NOT NULL,
    use_testnet INTEGER NOT NULL DEFAULT 1,
    base_asset TEXT NOT NULL,
    quote_asset TEXT NOT NULL,
    interval TEXT NOT NULL,
    poll_ms INTEGER NOT NULL,
    dry_run INTEGER NOT NULL DEFAULT 1,
    strategy_type TEXT NOT NULL,
    strategy_fast_period INTEGER NOT NULL,
    strategy_slow_period INTEGER NOT NULL,
    risk_order_quote_amount REAL NOT NULL,
    risk_leverage INTEGER NOT NULL,
    risk_quantity_step REAL NOT NULL,
    risk_stop_loss_percent REAL NOT NULL,
    risk_take_profit_percent REAL NOT NULL,
    risk_max_daily_loss_percent REAL NOT NULL,
    risk_max_total_loss_percent REAL NOT NULL,
    position_prevent_duplicate_orders INTEGER NOT NULL DEFAULT 1,
    position_cooldown_candles INTEGER NOT NULL DEFAULT 0,
    virtual_balance_initial REAL,
    virtual_balance_current_quote REAL,
    virtual_balance_current_base REAL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS bot_states (
    bot_id TEXT PRIMARY KEY,
    updated_at TEXT NOT NULL,
    ok INTEGER NOT NULL,
    status TEXT NOT NULL,
    error_message TEXT,
    config TEXT,
    market_data TEXT,
    account TEXT,
    position TEXT,
    last_decision TEXT,
    FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_bots_enabled ON bots(enabled);
  CREATE INDEX IF NOT EXISTS idx_bot_states_bot_id ON bot_states(bot_id);
`);

export type BotConfig = {
  id: string;
  name: string;
  enabled: boolean;
  market: 'spot' | 'futures';
  useTestnet: boolean;
  baseAsset: string;
  quoteAsset: string;
  interval: string;
  pollMs: number;
  dryRun: boolean;
  strategy: {
    type: 'ma_cross';
    fastPeriod: number;
    slowPeriod: number;
  };
  risk: {
    orderQuoteAmount: number;
    leverage: number;
    quantityStep: number;
    stopLossPercent: number;
    takeProfitPercent: number;
    maxDailyLossPercent: number;
    maxTotalLossPercent: number;
  };
  position: {
    preventDuplicateOrders: boolean;
    cooldownCandles: number;
  };
  virtualBalance?: {
    initialQuoteBalance: number;
    currentQuoteBalance: number;
    currentBaseBalance: number;
  };
};

export type BotState = {
  botId: string;
  updatedAt: string;
  ok: boolean;
  status: string;
  error?: { message?: string } | null;
  config?: any;
  marketData?: any;
  account?: any;
  position?: any;
  lastDecision?: any;
};

// Bot CRUD operations
export function getAllBots(): BotConfig[] {
  const rows = db.prepare('SELECT * FROM bots ORDER BY created_at').all();
  return rows.map(rowToBot);
}

export function getBotById(id: string): BotConfig | null {
  const row = db.prepare('SELECT * FROM bots WHERE id = ?').get(id);
  return row ? rowToBot(row as any) : null;
}

export function createBot(bot: BotConfig): void {
  const stmt = db.prepare(`
    INSERT INTO bots (
      id, name, enabled, market, use_testnet, base_asset, quote_asset,
      interval, poll_ms, dry_run, strategy_type, strategy_fast_period,
      strategy_slow_period, risk_order_quote_amount, risk_leverage,
      risk_quantity_step, risk_stop_loss_percent, risk_take_profit_percent,
      risk_max_daily_loss_percent, risk_max_total_loss_percent,
      position_prevent_duplicate_orders, position_cooldown_candles,
      virtual_balance_initial, virtual_balance_current_quote, virtual_balance_current_base
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    bot.id,
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
    bot.virtualBalance?.currentBaseBalance || null
  );
}

export function updateBot(bot: BotConfig): void {
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
    bot.id
  );
}

export function deleteBot(id: string): void {
  db.prepare('DELETE FROM bots WHERE id = ?').run(id);
}

// Bot State operations
export function getAllBotStates(): BotState[] {
  const rows = db.prepare('SELECT * FROM bot_states').all();
  return rows.map(rowToState);
}

export function getBotState(botId: string): BotState | null {
  const row = db.prepare('SELECT * FROM bot_states WHERE bot_id = ?').get(botId);
  return row ? rowToState(row as any) : null;
}

export function upsertBotState(state: BotState): void {
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
    state.lastDecision ? JSON.stringify(state.lastDecision) : null
  );
}

// Helper functions
function rowToBot(row: any): BotConfig {
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

function rowToState(row: any): BotState {
  return {
    botId: row.bot_id,
    updatedAt: row.updated_at,
    ok: Boolean(row.ok),
    status: row.status,
    error: row.error_message ? { message: row.error_message } : null,
    config: row.config ? JSON.parse(row.config) : undefined,
    marketData: row.market_data ? JSON.parse(row.market_data) : undefined,
    account: row.account ? JSON.parse(row.account) : undefined,
    position: row.position ? JSON.parse(row.position) : undefined,
    lastDecision: row.last_decision ? JSON.parse(row.last_decision) : undefined,
  };
}

export function closeDatabase(): void {
  db.close();
}

export default db;
