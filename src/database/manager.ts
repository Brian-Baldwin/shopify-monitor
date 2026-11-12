import sqlite3 from 'sqlite3';
import { Database } from 'sqlite3';
import path from 'path';

export interface Product {
  id: string;
  shopify_id: string;
  title: string;
  handle: string;
  price: number;
  is_available: boolean;
  inventory_quantity: number;
  image_url: string | null;
  last_checked: string;
  was_available: boolean;
  restocked_at: string | null;
  variants_json: string;
}

export interface RestockEvent {
  id: string;
  product_id: string;
  product_title: string;
  occurred_at: string;
  notified: boolean;
}

export interface StockSnapshotItem {
  shopify_id: string;
  title: string;
  handle: string;
  inventory_quantity: number;
}

export class DatabaseManager {
  private db: Database;
  private dbPath: string;

  constructor(dbPath: string = './data/pokemon_monitor.db') {
    this.dbPath = dbPath;
    this.db = new sqlite3.Database(this.dbPath);
    this.db.configure('busyTimeout', 10000);
  }

  async initialize(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.serialize(() => {
        // Products table
        this.db.run(
          `CREATE TABLE IF NOT EXISTS products (
            id TEXT PRIMARY KEY,
            shopify_id TEXT UNIQUE NOT NULL,
            title TEXT NOT NULL,
            handle TEXT NOT NULL,
            price REAL,
            is_available BOOLEAN DEFAULT 1,
            inventory_quantity INTEGER DEFAULT 0,
            image_url TEXT,
            last_checked TEXT NOT NULL,
            was_available BOOLEAN DEFAULT 1,
            restocked_at TEXT,
            variants_json TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
          )`,
          (err: Error | null) => {
            if (err) reject(err);
          }
        );

        // Migration: add inventory_quantity to databases created before this column existed
        this.db.run(
          `ALTER TABLE products ADD COLUMN inventory_quantity INTEGER DEFAULT 0`,
          (err: Error | null) => {
            if (err && !/duplicate column name/i.test(err.message)) reject(err);
          }
        );

        // Migration: add image_url to databases created before this column existed
        this.db.run(
          `ALTER TABLE products ADD COLUMN image_url TEXT`,
          (err: Error | null) => {
            if (err && !/duplicate column name/i.test(err.message)) reject(err);
          }
        );

        // Restock events table
        this.db.run(
          `CREATE TABLE IF NOT EXISTS restock_events (
            id TEXT PRIMARY KEY,
            product_id TEXT NOT NULL,
            product_title TEXT NOT NULL,
            occurred_at TEXT DEFAULT CURRENT_TIMESTAMP,
            notified BOOLEAN DEFAULT 0,
            FOREIGN KEY (product_id) REFERENCES products(id)
          )`,
          (err: Error | null) => {
            if (err) reject(err);
          }
        );

        // Monitoring logs
        this.db.run(
          `CREATE TABLE IF NOT EXISTS monitoring_logs (
            id TEXT PRIMARY KEY,
            check_time TEXT DEFAULT CURRENT_TIMESTAMP,
            products_checked INTEGER,
            restocks_detected INTEGER,
            errors_count INTEGER,
            error_messages TEXT
          )`,
          (err: Error | null) => {
            if (err) reject(err);
          }
        );

        // Daily stock snapshots, used to compare stock levels day-over-day
        this.db.run(
          `CREATE TABLE IF NOT EXISTS stock_snapshots (
            id TEXT PRIMARY KEY,
            snapshot_date TEXT NOT NULL,
            shopify_id TEXT NOT NULL,
            title TEXT NOT NULL,
            handle TEXT NOT NULL,
            inventory_quantity INTEGER NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
          )`,
          (err: Error | null) => {
            if (err) reject(err);
          }
        );

        this.db.run(
          `CREATE INDEX IF NOT EXISTS idx_stock_snapshots_date ON stock_snapshots(snapshot_date)`,
          (err: Error | null) => {
            if (err) reject(err);
          }
        );

        // Migrations for slot-aware intraday snapshots
        this.db.run(
          `ALTER TABLE stock_snapshots ADD COLUMN snapshot_slot TEXT NOT NULL DEFAULT 'midnight'`,
          (err: Error | null) => {
            if (err && !/duplicate column name/i.test(err.message)) reject(err);
          }
        );
        this.db.run(
          `ALTER TABLE stock_snapshots ADD COLUMN snapshot_datetime TEXT NOT NULL DEFAULT ''`,
          (err: Error | null) => {
            if (err && !/duplicate column name/i.test(err.message)) reject(err);
          }
        );
        this.db.run(
          `CREATE INDEX IF NOT EXISTS idx_stock_snapshots_datetime ON stock_snapshots(snapshot_datetime)`,
          (err: Error | null) => {
            if (err) reject(err);
          }
        );

        resolve();
      });
    });
  }

  // Products table methods
  async upsertProduct(product: Omit<Product, 'created_at' | 'updated_at'>): Promise<void> {
    return new Promise((resolve, reject) => {
      const stmt = this.db.prepare(`
        INSERT INTO products (id, shopify_id, title, handle, price, is_available, inventory_quantity, image_url, last_checked, was_available, restocked_at, variants_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(shopify_id) DO UPDATE SET
          title=excluded.title,
          price=excluded.price,
          is_available=excluded.is_available,
          inventory_quantity=excluded.inventory_quantity,
          image_url=excluded.image_url,
          was_available=(SELECT is_available FROM products WHERE shopify_id=excluded.shopify_id),
          last_checked=excluded.last_checked,
          variants_json=excluded.variants_json,
          updated_at=CURRENT_TIMESTAMP
      `);

      stmt.run(
        product.id,
        product.shopify_id,
        product.title,
        product.handle,
        product.price,
        product.is_available ? 1 : 0,
        product.inventory_quantity,
        product.image_url,
        product.last_checked,
        product.was_available ? 1 : 0,
        product.restocked_at,
        product.variants_json,
        (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        }
      );
      stmt.finalize();
    });
  }

  async getProduct(shopifyId: string): Promise<Product | null> {
    return new Promise((resolve, reject) => {
      this.db.get(
        'SELECT * FROM products WHERE shopify_id = ?',
        [shopifyId],
        (err: Error | null, row: any) => {
          if (err) reject(err);
          else resolve(row || null);
        }
      );
    });
  }

  async getAllProducts(): Promise<Product[]> {
    return new Promise((resolve, reject) => {
      this.db.all('SELECT * FROM products ORDER BY updated_at DESC', (err: Error | null, rows: any[]) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }

  async getInStockProducts(): Promise<Product[]> {
    return new Promise((resolve, reject) => {
      this.db.all(
        'SELECT * FROM products WHERE is_available = 1 ORDER BY title ASC',
        (err: Error | null, rows: any[]) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });
  }

  async getRestockedProducts(): Promise<Product[]> {
    return new Promise((resolve, reject) => {
      this.db.all(
        'SELECT * FROM products WHERE is_available = 1 AND was_available = 0 ORDER BY restocked_at DESC',
        (err: Error | null, rows: any[]) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });
  }

  // Stock snapshot methods (for stock comparison reports)
  async saveStockSnapshot(date: string, slot: 'midnight' | 'noon' | '4pm' | '9pm', products: Product[]): Promise<void> {
    const SLOT_TIMES: Record<string, string> = { midnight: '00:00', noon: '12:00', '4pm': '16:00', '9pm': '21:00' };
    const datetime = `${date} ${SLOT_TIMES[slot]}`;

    return new Promise((resolve, reject) => {
      const stmt = this.db.prepare(
        `INSERT OR REPLACE INTO stock_snapshots
           (id, snapshot_date, snapshot_slot, snapshot_datetime, shopify_id, title, handle, inventory_quantity)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );

      for (const product of products) {
        stmt.run(
          `${date}_${slot}_${product.shopify_id}`,
          date,
          slot,
          datetime,
          product.shopify_id,
          product.title,
          product.handle,
          product.inventory_quantity
        );
      }

      stmt.finalize((err: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /** Returns the most recent snapshot taken strictly before `beforeDatetime` ('YYYY-MM-DD HH:MM'). */
  async getMostRecentSnapshotBefore(
    beforeDatetime: string
  ): Promise<{ snapshot_date: string; snapshot_slot: string } | null> {
    return new Promise((resolve, reject) => {
      this.db.get(
        `SELECT snapshot_date, snapshot_slot FROM stock_snapshots
         WHERE snapshot_datetime != '' AND snapshot_datetime < ?
         ORDER BY snapshot_datetime DESC LIMIT 1`,
        [beforeDatetime],
        (err: Error | null, row: any) => {
          if (err) reject(err);
          else resolve(row ? { snapshot_date: row.snapshot_date, snapshot_slot: row.snapshot_slot } : null);
        }
      );
    });
  }

  async getSnapshotBySlot(date: string, slot: string): Promise<StockSnapshotItem[]> {
    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT shopify_id, title, handle, inventory_quantity FROM stock_snapshots
         WHERE snapshot_date = ? AND snapshot_slot = ?`,
        [date, slot],
        (err: Error | null, rows: any[]) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });
  }

  // Restock events methods
  async addRestockEvent(event: Omit<RestockEvent, 'occurred_at'>): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.run(
        'INSERT INTO restock_events (id, product_id, product_title, notified) VALUES (?, ?, ?, ?)',
        [event.id, event.product_id, event.product_title, event.notified ? 1 : 0],
        (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  async getUnnotifiedEvents(): Promise<RestockEvent[]> {
    return new Promise((resolve, reject) => {
      this.db.all(
        'SELECT * FROM restock_events WHERE notified = 0 ORDER BY occurred_at ASC',
        (err: Error | null, rows: any[]) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });
  }

  async markEventAsNotified(eventId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.run(
        'UPDATE restock_events SET notified = 1 WHERE id = ?',
        [eventId],
        (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  // Monitoring logs
  async addMonitoringLog(
    productsChecked: number,
    restocksDetected: number,
    errorsCount: number,
    errorMessages: string = ''
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const id = `log_${Date.now()}`;
      this.db.run(
        'INSERT INTO monitoring_logs (id, products_checked, restocks_detected, errors_count, error_messages) VALUES (?, ?, ?, ?, ?)',
        [id, productsChecked, restocksDetected, errorsCount, errorMessages],
        (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.close((err: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}
