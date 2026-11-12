import { DatabaseManager } from './manager';
import path from 'path';
import fs from 'fs';

async function initializeDatabase() {
  const dbPath = process.env.DATABASE_PATH || './data/pokemon_monitor.db';
  const dbDir = path.dirname(dbPath);

  // Create data directory if it doesn't exist
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const db = new DatabaseManager(dbPath);
  
  try {
    await db.initialize();
    console.log('✓ Database initialized successfully');
    console.log(`  Database location: ${dbPath}`);
  } catch (error) {
    console.error('✗ Failed to initialize database:', error);
    process.exit(1);
  } finally {
    await db.close();
  }
}

initializeDatabase();
