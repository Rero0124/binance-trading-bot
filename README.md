This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Trading Bot

This repo contains:

- A Next.js web dashboard for managing **multiple bots** and viewing their status.
- A separate Node.js bot process (managed by pm2) that runs all enabled bots simultaneously.
- Each bot reads its config from `data/bot-config.json` and writes status to `data/bot-state.json`.

### 1) Configure API keys

Create `.env` based on `.env.example`:

```bash
cp .env.example .env
```

Set your API keys:

**For Mainnet (Real Trading)**:
- `BINANCE_API_KEY`
- `BINANCE_API_SECRET`

**For Testnet (Paper Trading)**:
- `TEST_BINANCE_API_KEY`
- `TEST_BINANCE_API_SECRET`

**Note**: You can set either or both. Each bot will use the appropriate keys based on its `useTestnet` setting:
- Bots with `useTestnet: false` use `BINANCE_API_KEY/SECRET`
- Bots with `useTestnet: true` use `TEST_BINANCE_API_KEY/SECRET`

**⚠️ IMPORTANT SAFETY RULES**:
1. **Always test on testnet first** before enabling real trading
2. **Minimum order size**: 10 USDT (enforced by validation)
3. **Cannot disable dry-run on mainnet** without explicit 2-step confirmation
4. **Stop-loss and take-profit are mandatory** (must be > 0)
5. **Bot auto-disables** when max loss limits are reached

### 2) Start the web dashboard

```bash
pnpm dev
```

Open `http://localhost:3000`.

### 3) Control the bots

**PM2 Process Control** (manages all bots):
- Click **"PM2 시작"** (Start PM2) to start the bot process
- Click **"PM2 중지"** (Stop PM2) to stop the bot process
- Click **"재시작"** (Restart) to restart the bot process

**Individual Bot Control**:
- Each bot has a toggle switch in the bot list
- Click the toggle to enable/disable individual bots
- Only enabled bots will execute trades (when PM2 is running)
- Disabled bots will show "비활성" (Disabled) status

Alternatively, you can use pm2 commands:

```bash
pnpm pm2:start   # Start PM2 process
pnpm pm2:stop    # Stop PM2 process
pnpm pm2:restart # Restart PM2 process
pnpm pm2:logs    # View logs
```

### Multiple Bots

You can add multiple bots with different configurations:

- Each bot has its own settings (symbol, market, strategy, risk)
- All bots share the same API key/secret from `.env`
- Click **"+ 추가"** (Add) button to create a new bot
- Use the toggle switch to enable/disable each bot individually
- Edit or delete bots using the buttons in the settings panel
- The web UI is in Korean for better user experience

**How it works**:
1. PM2 runs the bot process continuously
2. The bot process monitors all bots in the config
3. Only bots with `enabled: true` will execute trades
4. You can enable/disable bots without restarting PM2

### Bot Configuration Settings

**Strategy Settings**:
- **Fast Period**: Fast moving average period (must be < slow period)
- **Slow Period**: Slow moving average period
- **Interval**: Candle timeframe (1m, 5m, 15m, 1h)

**Risk Management Settings**:
- **Order Amount**: USDT amount per order (minimum 10 USDT)
- **Leverage**: Futures leverage (1-125x, only for futures market)
- **Stop-Loss %**: Percentage loss to trigger automatic position close
- **Take-Profit %**: Percentage profit to trigger automatic position close
- **Max Daily Loss %**: Maximum daily loss before bot auto-disables
- **Max Total Loss %**: Maximum cumulative loss before bot auto-disables

**Position Management Settings**:
- **Prevent Duplicate Orders**: Block new orders while position is open
- **Cooldown Candles**: Number of candles to wait before re-entry after closing

**Important Notes**:
- Spot market: Leverage setting is hidden (not applicable)
- Real trading requires 2-step confirmation with explicit acknowledgment
- Settings changes apply on next candle (not immediate)
- All percentage-based limits are calculated from entry price

### Safety Features

**Risk Management**:
- **Stop-Loss**: Automatically close positions when loss reaches configured percentage (default: 1.0%)
- **Take-Profit**: Automatically close positions when profit reaches configured percentage (default: 1.5%)
- **Max Daily Loss**: Bot automatically disables when daily loss exceeds limit (default: 5.0%)
- **Max Total Loss**: Bot automatically disables when cumulative loss exceeds limit (default: 10.0%)
- **Minimum Order Amount**: Enforces minimum 10 USDT order size (Binance requirement)

**Position Management**:
- **Duplicate Order Prevention**: Prevents opening new positions while one is active (configurable)
- **Cooldown Period**: Prevents re-entry for N candles after closing a position (default: 3 candles)
- **Position State Tracking**: Monitors LONG/SHORT/NONE states to prevent conflicting orders

**Real-Trade Protection**:
- **2-Step Confirmation**: Requires explicit acknowledgment before enabling real trading
- **Configuration Summary**: Shows all critical settings before real-trade activation
- **Dry-Run Default**: New bots start in simulation mode by default
- **Testnet-First Policy**: Cannot enable real trading without testnet testing first

### Features

- **Web-based bot control**: Start, stop, and restart bots directly from the web UI
- **Real-time monitoring**: View live status, signals, positions, and P&L for each bot
- **Multiple bot support**: Run multiple bots with different strategies simultaneously
- **Separate API keys**: Use different API keys for testnet and mainnet
- **Secure API key management**: API Key/Secret are read from `.env` only (not from the website)
- **Korean UI**: User-friendly interface in Korean
- **Dry run mode**: Test strategies without real orders
- **Testnet support**: Practice with testnet before going live
- **SSE Real-time Updates**: Server-sent events for smooth UI updates without page refresh

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
