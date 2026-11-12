import 'dotenv/config';
import { DatabaseManager } from './database/manager';
import { ShopifyService } from './services/shopify';
import { NotificationService } from './services/notification';
import { ProductMonitor } from './services/monitor';
import fs from 'fs';
import path from 'path';

async function main() {
  console.log('🚀 Pokemon Restock Monitor\n');
  console.log('Available commands:');
  console.log('  npm run dev              - Run the monitor once');
  console.log('  npm run monitor          - Start continuous monitoring');
  console.log('  npm run init-db          - Initialize database');
  console.log('\nUsage:');
  console.log('  1. Copy .env.example to .env');
  console.log('  2. Fill in your store URL and Discord webhook settings');
  console.log('  3. Run: npm install');
  console.log('  4. Run: npm run init-db');
  console.log('  5. Run: npm run monitor\n');
}

main();
