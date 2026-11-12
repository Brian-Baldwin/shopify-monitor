# Quick Start Guide

## Step 1: Get Your Discord Webhook URL

1. Open your Discord server
2. Go to **Server Settings** → **Webhooks**
3. Click **New Webhook** and give it a name like "Pokemon Alerts"
4. Click **Copy Webhook URL**

## Step 2: Set Up Environment Variables

1. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` and add your values:
   ```env
   STORE_URL=https://hobbiesville.com
   DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/YOUR_WEBHOOK_ID/YOUR_WEBHOOK_TOKEN
   ```

The monitor reads product data from the store's public `products.json`
endpoints, so no Shopify Storefront API token or admin login is needed.

## Step 3: Initialize Database

```bash
npm run init-db
```

This creates the SQLite database where product data will be stored.

## Step 4: Run the Monitor

### Option A: Single Check (Test Mode)
```bash
npm run dev
```

### Option B: Continuous Monitoring (Production)
```bash
npm run monitor
```

The monitor will:
- Check for Pokemon products immediately
- Schedule checks every 10 minutes (configurable)
- Send Discord alerts when products restock
- Save all data to the SQLite database

## Configuration

Edit your `.env` file to customize:

| Variable | Description | Default |
|----------|-------------|---------|
| `MONITOR_INTERVAL_MINUTES` | How often to check (in minutes) Mon-Fri 9am-9pm ET; outside that window the monitor checks 4x less often (every `MONITOR_INTERVAL_MINUTES * 4`) | 10 |
| `STORE_URL` | Storefront base URL to monitor | For example, https://hobbiesville.com |
| `DISCORD_WEBHOOK_URL` | Discord webhook for alerts | Required |
| `DATABASE_PATH` | Where to store data | ./data/pokemon_monitor.db |
| `PROXY_LIST` | Optional comma/newline list of proxies (`host:port:user:pass`) to retry through when a 429 is hit | Not set |
| `PROXY_LIST_FILE` | Optional path to a file with one proxy per line, as an alternative to `PROXY_LIST` | Not set |

## Example Discord Notification

When a product restocks, you'll receive a Discord message with:
- Product name
- Product link to buy
- Price
- Restocked timestamp

## Example Output

```
🚀 Initializing Pokemon Restock Monitor...

✓ Database initialized
✓ Shopify service initialized
✓ Discord webhook verified and ready

📦 Starting product check...
Found 45 Pokemon products on Shopify

🎉 RESTOCK DETECTED: Pokemon Booster Box - Scarlet
✓ Discord notification sent

✓ Check completed: 1 restocks detected

⏱️  Scheduling monitoring every 10 minutes

📊 Current Status:
   Total Products Tracked: 45
   Restocked Products: 1

✓ Monitor is running. Press Ctrl+C to stop.
```

## Troubleshooting

### "Could not verify connection to store"
- Make sure you created a `.env` file (copy from `.env.example`)
- Verify `STORE_URL` is correct and the storefront is publicly reachable

### Discord notifications not arriving
- Check `.env` for `DISCORD_WEBHOOK_URL`
- Verify the webhook URL is correct and copied completely
- Make sure the webhook is not expired
- Check Discord permissions on the webhook channel

### Monitor won't start
- Run `npm install` first
- Try `npm run init-db` to initialize database
- Check that `node_modules/` was created

## Next Steps

- Monitor runs in the background - keep terminal window open
- Check your Discord channel for restock alerts
- View restock history in the database
- See full documentation in [README.md](README.md)

## Support

For issues:
1. Check the console output for error messages
2. Review [README.md](README.md) for detailed documentation
3. Verify your `.env` configuration
4. Ensure `STORE_URL` and your Discord webhook are correct
