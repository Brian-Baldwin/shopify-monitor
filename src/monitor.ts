import 'dotenv/config';
import { DatabaseManager } from './database/manager';
import { ShopifyService } from './services/shopify';
import { NotificationService } from './services/notification';
import { ProductMonitor } from './services/monitor';
import { loadProxiesFromEnv } from './services/proxyManager';
import { getIntervalMinutes, OFF_HOURS_MULTIPLIER, getMsUntilNextEasternMidnight, getMsUntilNextWeekdayEasternTime } from './services/schedule';
import fs from 'fs';
import path from 'path';

let monitor: ProductMonitor;
let isShuttingDown = false;
let scheduleTimer: NodeJS.Timeout | null = null;
let dailyReportTimer: NodeJS.Timeout | null = null;
let noonReportTimer: NodeJS.Timeout | null = null;
let afternoonReportTimer: NodeJS.Timeout | null = null;
let eveningReportTimer: NodeJS.Timeout | null = null;

async function initializeServices() {
  console.log('🚀 Initializing Pokemon Restock Monitor...\n');

  // Initialize database
  const dbPath = process.env.DATABASE_PATH || './data/pokemon_monitor.db';
  const dbDir = path.dirname(dbPath);
  
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const db = new DatabaseManager(dbPath);
  await db.initialize();
  console.log('✓ Database initialized');

  // Initialize Shopify service (uses the store's public products.json endpoints)
  const storeUrl = process.env.STORE_URL || 'https://princedist.com';
  const proxies = loadProxiesFromEnv();
  const shopify = new ShopifyService(storeUrl, proxies);

  const connectionOk = await shopify.verifyConnection();
  if (!connectionOk) {
    console.warn('⚠ Warning: Could not verify connection to store');
  }
  console.log('✓ Shopify service initialized');

  // Initialize notification service
  const notification = new NotificationService(
    process.env.DISCORD_WEBHOOK_URL || ''
  );

  const discordConfigured = !!process.env.DISCORD_WEBHOOK_URL;
  if (discordConfigured) {
    await notification.verifyConnection();
  } else {
    console.warn('⚠ Discord webhook not configured');
  }

  // Initialize monitor
  monitor = new ProductMonitor(db, shopify, notification);
  console.log('✓ Monitor service initialized\n');

  return { db, monitor };
}

async function runCheck() {
  if (isShuttingDown) return;

  try {
    const stats = await monitor.checkProducts();

    if (stats.errors.length > 0) {
      console.error('Errors during check:', stats.errors);
    }
  } catch (error) {
    console.error('Error during scheduled check:', error);
  }
}

/** Runs a check, then reschedules itself using the interval for the new current time. */
function scheduleNextCheck(baseIntervalMinutes: number) {
  if (isShuttingDown) return;

  const intervalMinutes = getIntervalMinutes(baseIntervalMinutes);
  const offHours = intervalMinutes !== baseIntervalMinutes;

  console.log(`⏱️  Next check in ${intervalMinutes} minutes${offHours ? ' (off-hours)' : ''}`);

  scheduleTimer = setTimeout(async () => {
    await runCheck();
    scheduleNextCheck(baseIntervalMinutes);
  }, intervalMinutes * 60 * 1000);
}

async function runDailyReport() {
  if (isShuttingDown) return;

  try {
    await monitor.runStockReport('midnight');
  } catch (error) {
    console.error('Error during daily stock report:', error);
  }
}

/** Fires the midnight stock report, then reschedules itself for the following midnight ET. */
function scheduleNextDailyReport() {
  if (isShuttingDown) return;

  const msUntilMidnight = getMsUntilNextEasternMidnight();
  console.log(`📊 Next daily stock report in ${Math.round(msUntilMidnight / 60000)} minutes (midnight ET)`);

  dailyReportTimer = setTimeout(async () => {
    await runDailyReport();
    scheduleNextDailyReport();
  }, msUntilMidnight);
}

/** Fires the 12pm weekday stock update, then reschedules itself for the next weekday noon. */
function scheduleNextNoonReport() {
  if (isShuttingDown) return;

  const ms = getMsUntilNextWeekdayEasternTime(12);
  console.log(`📊 Next 12pm stock update in ${Math.round(ms / 60000)} minutes`);

  noonReportTimer = setTimeout(async () => {
    if (!isShuttingDown) {
      try { await monitor.runStockReport('noon'); }
      catch (error) { console.error('Error during 12pm stock update:', error); }
    }
    scheduleNextNoonReport();
  }, ms);
}

/** Fires the 4pm weekday stock update, then reschedules itself for the next weekday 4pm. */
function scheduleNextAfternoonReport() {
  if (isShuttingDown) return;

  const ms = getMsUntilNextWeekdayEasternTime(16);
  console.log(`📊 Next 4pm stock update in ${Math.round(ms / 60000)} minutes`);

  afternoonReportTimer = setTimeout(async () => {
    if (!isShuttingDown) {
      try { await monitor.runStockReport('4pm'); }
      catch (error) { console.error('Error during 4pm stock update:', error); }
    }
    scheduleNextAfternoonReport();
  }, ms);
}

/** Fires the 9pm weekday stock update, then reschedules itself for the next weekday 9pm. */
function scheduleNextEveningReport() {
  if (isShuttingDown) return;

  const ms = getMsUntilNextWeekdayEasternTime(21);
  console.log(`📊 Next 9pm stock update in ${Math.round(ms / 60000)} minutes`);

  eveningReportTimer = setTimeout(async () => {
    if (!isShuttingDown) {
      try { await monitor.runStockReport('9pm'); }
      catch (error) { console.error('Error during 9pm stock update:', error); }
    }
    scheduleNextEveningReport();
  }, ms);
}

async function startMonitoring() {
  try {
    const { db, monitor: productMonitor } = await initializeServices();

    // Run initial check
    console.log('Running initial product check...\n');
    await runCheck();

    // Send a full stock report to Discord now that the DB reflects current availability
    await productMonitor.sendStartupStockReport();

    // Schedule monitoring
    const baseIntervalMinutes = parseInt(process.env.MONITOR_INTERVAL_MINUTES || '10');
    const offHoursIntervalMinutes = baseIntervalMinutes * OFF_HOURS_MULTIPLIER;

    console.log(`\n⏱️  Monitoring every ${baseIntervalMinutes} minutes (Mon-Fri 9am-9pm ET)`);
    console.log(`   and every ${offHoursIntervalMinutes} minutes outside that window\n`);

    scheduleNextCheck(baseIntervalMinutes);

    // Schedule stock reports: midnight ET daily, 12pm/4pm/9pm weekdays
    scheduleNextDailyReport();
    scheduleNextNoonReport();
    scheduleNextAfternoonReport();
    scheduleNextEveningReport();

    console.log('✓ Monitor is running. Press Ctrl+C to stop.\n');

    // Show status
    const status = await productMonitor.getStatus();
    console.log(`📊 Current Status:`);
    console.log(`   Total Products Tracked: ${status.totalProducts}`);
    console.log(`   Restocked Products: ${status.restockedProducts}\n`);

    // Graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n\n🛑 Shutting down...');
      isShuttingDown = true;

      if (scheduleTimer) {
        clearTimeout(scheduleTimer);
      }

      if (dailyReportTimer) {
        clearTimeout(dailyReportTimer);
      }

      if (noonReportTimer) {
        clearTimeout(noonReportTimer);
      }

      if (afternoonReportTimer) {
        clearTimeout(afternoonReportTimer);
      }

      if (eveningReportTimer) {
        clearTimeout(eveningReportTimer);
      }

      try {
        await db.close();
        console.log('✓ Database closed');
        process.exit(0);
      } catch (error) {
        console.error('Error during shutdown:', error);
        process.exit(1);
      }
    });
  } catch (error) {
    console.error('Failed to start monitoring:', error);
    process.exit(1);
  }
}

startMonitoring();
