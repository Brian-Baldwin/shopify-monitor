# Pokemon Restock Monitor - Copilot Instructions

This project is a TypeScript/Node.js application for monitoring Shopify Pokemon product restocks with Discord notifications.

## Project Overview

- **Type**: Node.js/TypeScript CLI Application
- **Purpose**: Monitor Pokemon products on Shopify for restocks and send Discord alerts
- **Database**: SQLite for tracking products and restock events
- **Notifications**: Discord webhooks for real-time alerts

## Setup Status

✅ **Completed**:
- Project scaffolding with TypeScript configuration
- Database layer with SQLite
- Public Shopify products.json integration (no Storefront API token needed)
- Discord webhook notification service
- Product monitoring logic with restock and out-of-stock detection
- Adaptive scheduled monitoring (base interval on weekdays 9am-9pm ET, 4x interval otherwise)
- Stock reports at midnight ET (daily), 12pm/4pm/9pm ET (Mon-Fri), each comparing to the previous snapshot with explicit +/- deltas
- Dependencies installed and compiled
- Comprehensive documentation

## How to Use

### First Time Setup

1. **Install dependencies** (already done):
   ```bash
   npm install
   ```

2. **Initialize database**:
   ```bash
   npm run init-db
   ```

3. **Configure environment** - Copy and edit `.env.example`:
   ```bash
   cp .env.example .env
   # Edit .env with your store URL and Discord webhook URL
   ```

4. **Start monitoring**:
   ```bash
   npm run monitor
   ```

### Available Commands

- `npm run dev` - Run monitor once for testing
- `npm run monitor` - Start continuous monitoring (recommended)
- `npm run init-db` - Initialize or reset database
- `npm run build` - Compile TypeScript
- `npm run clean` - Remove build artifacts

## Configuration

See `.env.example` for all available options. Key settings:

- `STORE_URL` - Storefront base URL to monitor (default: https://princedist.com)
- `DISCORD_WEBHOOK_URL` - Your Discord webhook URL (required)
- `MONITOR_INTERVAL_MINUTES` - Check frequency in minutes (default: 10)
- `DATABASE_PATH` - Where to store the SQLite database

## Project Structure

```
src/
├── database/
│   ├── manager.ts     - SQLite operations
│   └── init.ts        - Database initialization
├── services/
│   ├── shopify.ts     - Shopify API integration
│   ├── notification.ts - Discord webhook notifications
│   └── monitor.ts     - Restock detection logic
├── monitor.ts         - Scheduled monitoring entry point
└── index.ts           - Main entry point
```

## Development

To extend or modify:

1. **Add new monitoring features**: Edit `src/services/monitor.ts`
2. **Change Discord notifications**: Edit `src/services/notification.ts`
3. **Modify Shopify queries**: Edit `src/services/shopify.ts`
4. **Update database schema**: Edit `src/database/manager.ts` and `src/database/init.ts`

## Documentation

- **SETUP.md** - Quick start guide
- **README.md** - Full documentation with troubleshooting
- **.env.example** - Environment variables reference

## Notes

- The monitor runs continuously with scheduled checks
- Discord notifications are sent to your configured webhook
- All data is stored in SQLite database (./data/pokemon_monitor.db by default)
- Logs are printed to console during execution
- Press Ctrl+C to gracefully stop the monitor

