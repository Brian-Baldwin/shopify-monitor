# Pokemon Restock Monitor for Shopify

A Node.js/TypeScript application that monitors Shopify's Pokemon product collection on the configured site for restocks and sends real-time notifications when products become available again.

## Features

✅ **Automated Monitoring** - Checks for Pokemon product availability on a scheduled interval  
✅ **Restock Detection** - Identifies products transitioning from out-of-stock to in-stock  
✅ **Out-of-Stock Detection** - Identifies products transitioning from in-stock to out-of-stock  
✅ **Discord Notifications** - Sends alerts to your Discord server when restocks or out-of-stocks are detected  
✅ **Stock Reports** - Automated reports at midnight ET (daily), 12pm ET (weekdays), and 4pm ET (weekdays) comparing stock levels to the previous snapshot  
✅ **Comprehensive Logging** - Records all monitoring checks and events  
✅ **Configurable Intervals** - Adjustable check frequency (default: 10 minutes)  

## Prerequisites

- Node.js 16+ and npm
- Discord server with webhook permissions for notifications

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Copy the example env file and fill in your values:

```bash
cp .env.example .env
```

Edit `.env` with your settings:

```env
# Store Configuration (uses the store's public products.json endpoints,
# no Shopify Storefront API token or admin access required)
STORE_URL=https://hobbiesville.com

# Monitoring Configuration
MONITOR_INTERVAL_MINUTES=10

# Discord Notifications
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/your_webhook_id/your_webhook_token

# Database
DATABASE_PATH=./data/pokemon_monitor.db

# Optional: proxy list for 429 rate-limit fallback (see "Proxy Support" below)
# PROXY_LIST=1.2.3.4:8000:user1:pass1,5.6.7.8:8000:user2:pass2
```

### 3. Set Up Your Discord Webhook URL

1. Open your Discord server
2. Go to **Server Settings** → **Webhooks**
3. Click **New Webhook** and name it "Pokemon Restock Monitor"
4. Copy the webhook URL and paste into `.env` as `DISCORD_WEBHOOK_URL`

### 4. Initialize the Database

```bash
npm run init-db
```

This creates the SQLite database with required tables for products, restock events, and monitoring logs.

## Usage

### Run Monitor Once

```bash
npm run dev
```

This performs a single check of the Pokemon products and exits.

### Start Continuous Monitoring

```bash
npm run monitor
```

This starts the scheduled monitoring service that will:
- Check for restocks every N minutes (configured by `MONITOR_INTERVAL_MINUTES`) on weekdays 9am-9pm Eastern Time, and every 4N minutes outside that window
- Detect state changes and log restock events
- Send Discord notifications for restocked items
- Track all activity in the database

Press `Ctrl+C` to stop the monitor.

### Build

```bash
npm run build
```

Compiles TypeScript to JavaScript in the `dist/` directory.

## Project Structure

```
prince-monitor/
├── src/
│   ├── database/
│   │   ├── manager.ts        # SQLite database operations
│   │   └── init.ts           # Database initialization script
│   ├── services/
│   │   ├── shopify.ts        # Public Shopify products.json integration
│   │   ├── notification.ts   # Discord webhook notifications
│   │   └── monitor.ts        # Product monitoring logic
│   ├── monitor.ts            # Scheduled monitoring entry point
│   └── index.ts              # Main entry point
├── data/                      # Database directory (auto-created)
├── dist/                      # Compiled JavaScript (generated)
├── .env.example               # Environment variables template
├── .env                       # Your configuration (not in git)
├── package.json               # Dependencies and scripts
├── tsconfig.json              # TypeScript configuration
└── README.md                  # This file
```

## Database Schema

### Products Table
Tracks all monitored Pokemon products:
- `id` - Unique identifier
- `shopify_id` - Shopify product ID
- `title` - Product name
- `handle` - Product URL handle
- `price` - Current price
- `is_available` - Current availability status
- `was_available` - Previous availability status (for restock detection)
- `restocked_at` - Timestamp when product was restocked
- `last_checked` - Last monitoring check time
- `variants_json` - Product variants data

### Restock Events Table
Records all restock events:
- `id` - Unique event ID
- `product_id` - Reference to products table
- `product_title` - Product name at time of restock
- `occurred_at` - When the restock was detected
- `notified` - Whether notification was sent

### Monitoring Logs Table
Tracks monitoring check history:
- `id` - Unique log ID
- `check_time` - When the check ran
- `products_checked` - Number of products checked
- `restocks_detected` - Number of restocks found
- `errors_count` - Number of errors encountered
- `error_messages` - Error details

### Stock Snapshots Table
One row per product per day, used to power the daily stock report:
- `id` - Unique identifier (`${date}_${shopify_id}`)
- `snapshot_date` - Snapshot date (YYYY-MM-DD, Eastern Time)
- `shopify_id` - Shopify product ID
- `title` - Product name at time of snapshot
- `handle` - Product URL handle
- `inventory_quantity` - Inventory quantity at time of snapshot

## Monitoring Example

Here's what a typical monitoring session looks like:

```
🚀 Initializing Pokemon Restock Monitor...

✓ Database initialized
✓ Shopify service initialized
✓ Discord webhook verified and ready
✓ Monitor service initialized

Running initial product check...

📦 Starting product check...
Found 45 Pokemon products on Shopify
🎉 RESTOCK DETECTED: Pokemon Booster Box - Scarlet
✓ Discord notification sent for: Pokemon Booster Box - Scarlet
✓ Check completed: 1 restocks detected

⏱️  Monitoring every 10 minutes (Mon-Fri 9am-9pm ET)
   and every 40 minutes outside that window

⏱️  Next check in 10 minutes

✓ Monitor is running. Press Ctrl+C to stop.

📊 Current Status:
   Total Products Tracked: 45
   Restocked Products: 1
```

## Discord Notifications

When a product restocks, your Discord server will receive a message with:
- Product name and title
- Direct link to buy the product
- Current price
- Exact restock timestamp
- Pikachu thumbnail for fun! 🎉

When a product goes out of stock, your Discord server will receive a similar
message (red embed) with:
- Product name and title
- Link to the product page
- Last known price
- Stock level right before it sold out
- Exact out-of-stock timestamp

## Stock Reports

The monitor posts four recurring stock snapshots to Discord, each comparing
to the most recently saved snapshot before it:

| Report | When | Compares to |
|--------|------|-------------|
| 📊 Daily Report | Every midnight ET | Previous snapshot (typically yesterday's 9pm) |
| 📊 12pm Stock Update | Mon–Fri 12pm ET | That day's midnight snapshot |
| 📊 4pm Stock Update | Mon–Fri 4pm ET | That day's 12pm snapshot |
| 📊 9pm Stock Update | Mon–Fri 9pm ET | That day's 4pm snapshot |

Each report shows only changed products:

- 🆕 **Newly In Stock** — went from 0 to in-stock (e.g. `0 → 10 (+10)`)
- 📈 **Increased** — quantity went up (e.g. `3 → 5 (+2)`)
- 📉 **Decreased** — quantity went down but not to 0 (e.g. `8 → 3 (-5)`)
- ❌ **Out of Stock** — went from in-stock to 0 (e.g. `4 → 0 (-4)`)
- Total units in stock across all products

If there is no previous snapshot to compare against, the report notes this and
saves the current snapshot for future comparisons. These schedules are fixed
and not configurable via `.env`.

## Troubleshooting

### Discord notifications not arriving
- Verify `DISCORD_WEBHOOK_URL` is correct and completely copied
- Check that the webhook URL starts with `https://discord.com/api/webhooks/`
- Ensure the webhook hasn't expired or been deleted
- Verify the Discord channel exists and bot has permissions
- Look at error messages in console logs

### "No products found"
- Verify `STORE_URL` points to a reachable storefront (default: https://princedist.com)
- Check that the store has a Pokemon collection at `/collections/pokemon`
- The monitor falls back to scanning `/products.json` for titles containing "pokemon"

### Database errors
- Ensure `DATABASE_PATH` directory exists (created automatically)
- Check disk space and file permissions
- Try running `npm run init-db` again

### Monitor not detecting restocks
- Verify `MONITOR_INTERVAL_MINUTES` is reasonable (not too large)
- Check Shopify API response in console
- Ensure product data is being saved correctly: inspect `data/pokemon_monitor.db`

### Frequent 429 (rate limit) errors
- The monitor already adds delays between requests, but if Cloudflare is
  still rate-limiting your IP, configure `PROXY_LIST` (or `PROXY_LIST_FILE`)
  - see "Proxy Support" below

## Proxy Support (Optional)

If Cloudflare starts returning 429s for your IP, you can supply a list of
proxies. When a request gets a 429, the monitor automatically retries it
through the next proxy in the list, cycling back to the start once it
reaches the end.

Set `PROXY_LIST` (comma/newline separated) or `PROXY_LIST_FILE` (one proxy
per line, `#` for comments) in `.env`. Each entry can be:

```
host:port
host:port:username:password
http://username:password@host:port
```

Example:

```env
PROXY_LIST=198.51.100.10:8000:myuser:mypass,198.51.100.11:8000:myuser:mypass
```

If neither variable is set, requests go out directly with no behavior change.

## Configuration Tips

**Faster checks:** Set `MONITOR_INTERVAL_MINUTES=5` (every 5 minutes during business hours, every 20 minutes off-hours)

**Slower checks:** Set `MONITOR_INTERVAL_MINUTES=30` (every 30 minutes during business hours, every 2 hours off-hours)

**Adaptive scheduling:** The monitor always checks every `MONITOR_INTERVAL_MINUTES` on weekdays between 9am-9pm Eastern Time, and 4x less often (every `MONITOR_INTERVAL_MINUTES * 4`) outside that window (nights and weekends). This is fixed and not currently configurable via `.env`.

**Multiple Discord servers:** Create multiple webhooks and run multiple monitor instances with different `.env` files

**Database location:** Change `DATABASE_PATH` to store database elsewhere

## Advanced Usage

### View Restock History

```bash
sqlite3 data/pokemon_monitor.db
SELECT * FROM restock_events ORDER BY occurred_at DESC LIMIT 20;
```

### Check Current Product Status

```bash
sqlite3 data/pokemon_monitor.db
SELECT title, is_available, last_checked FROM products;
```

### Verify Monitoring Logs

```bash
sqlite3 data/pokemon_monitor.db
SELECT * FROM monitoring_logs ORDER BY check_time DESC LIMIT 10;
```

## Development

### Run in Development Mode

With TypeScript watching:

```bash
npm run dev
```

### TypeScript Compilation

```bash
npm run build
```

### Clean Build Artifacts

```bash
npm run clean
```

## Support & Contributing

For issues, questions, or feature requests, please check the logs first:
- Console output shows real-time monitoring activity
- Check `data/pokemon_monitor.db` for historical data
- Review error messages for configuration issues

## License

MIT

## Disclaimer

This tool is for personal use. Ensure you comply with Shopify's Terms of Service and the selected site's robots.txt and terms when using this monitor.
