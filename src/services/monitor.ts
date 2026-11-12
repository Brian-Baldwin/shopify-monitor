import { DatabaseManager, Product } from '../database/manager';
import { ShopifyService, ShopifyProduct } from './shopify';
import { NotificationService, RestockNotification, OutOfStockNotification, StockReportItem, StockChangeItem, DailyStockReport } from './notification';
import { getEasternDateString } from './schedule';

function generateId(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

export interface MonitoringStats {
  productsChecked: number;
  restocksDetected: number;
  outOfStockDetected: number;
  errors: string[];
  checkTime: Date;
}

interface ProcessResult {
  product: Product;
  event: 'restock' | 'out_of_stock' | null;
  previousQuantity: number;
}

export class ProductMonitor {
  private db: DatabaseManager;
  private shopify: ShopifyService;
  private notification: NotificationService;
  private isRunning: boolean = false;

  constructor(
    db: DatabaseManager,
    shopify: ShopifyService,
    notification: NotificationService
  ) {
    this.db = db;
    this.shopify = shopify;
    this.notification = notification;
  }

  async checkProducts(): Promise<MonitoringStats> {
    const stats: MonitoringStats = {
      productsChecked: 0,
      restocksDetected: 0,
      outOfStockDetected: 0,
      errors: [],
      checkTime: new Date(),
    };

    try {
      console.log('\n📦 Starting product check...');

      // Fetch current products from Shopify
      const shopifyProducts = await this.shopify.getPokemonProducts();
      console.log(`Found ${shopifyProducts.length} Pokemon products on Shopify`);
      stats.productsChecked = shopifyProducts.length;

      const restockedProducts: Product[] = [];
      const outOfStockProducts: { product: Product; previousQuantity: number }[] = [];

      // Check each product
      for (const shopifyProduct of shopifyProducts) {
        try {
          const result = await this.processProduct(shopifyProduct);
          if (result.event === 'restock') {
            restockedProducts.push(result.product);
            stats.restocksDetected++;
          } else if (result.event === 'out_of_stock') {
            outOfStockProducts.push({ product: result.product, previousQuantity: result.previousQuantity });
            stats.outOfStockDetected++;
          }
        } catch (error) {
          const errorMsg = `Error processing ${shopifyProduct.title}: ${error}`;
          console.error(errorMsg);
          stats.errors.push(errorMsg);
        }
      }

      // Log monitoring check
      await this.db.addMonitoringLog(
        stats.productsChecked,
        stats.restocksDetected,
        stats.errors.length,
        stats.errors.join('\n')
      );

      // Send notifications for restocked items
      if (restockedProducts.length > 0) {
        await this.notifyRestocks(restockedProducts);
      }

      // Send notifications for items that went out of stock
      if (outOfStockProducts.length > 0) {
        await this.notifyOutOfStock(outOfStockProducts);
      }

      console.log(
        `✓ Check completed: ${stats.restocksDetected} restocks detected, ${stats.outOfStockDetected} out-of-stock detected`
      );
      return stats;
    } catch (error) {
      const errorMsg = `Critical error during product check: ${error}`;
      console.error(errorMsg);
      stats.errors.push(errorMsg);

      await this.db.addMonitoringLog(
        stats.productsChecked,
        stats.restocksDetected,
        stats.errors.length,
        stats.errors.join('\n')
      );

      return stats;
    }
  }

  private async processProduct(shopifyProduct: ShopifyProduct): Promise<ProcessResult> {
    // Determine if product is available (any variant available)
    const isCurrentlyAvailable = shopifyProduct.variants.some((v) => v.available);

    // Get price
    const price = shopifyProduct.priceRange?.minVariantPrice?.amount
      ? parseFloat(shopifyProduct.priceRange.minVariantPrice.amount)
      : 0;

    // Total stock across all variants
    const inventoryQuantity = shopifyProduct.variants.reduce(
      (sum, v) => sum + (v.inventoryQuantity ?? 0),
      0
    );

    // Check if product exists in database
    const existingProduct = await this.db.getProduct(shopifyProduct.id);
    const wasAvailable = existingProduct?.is_available || false;
    const previousQuantity = existingProduct?.inventory_quantity ?? 0;

    // Create/update product record
    const product: Omit<Product, 'created_at' | 'updated_at'> = {
      id: existingProduct?.id || `prod_${generateId()}`,
      shopify_id: shopifyProduct.id,
      title: shopifyProduct.title,
      handle: shopifyProduct.handle,
      price,
      is_available: isCurrentlyAvailable,
      inventory_quantity: inventoryQuantity,
      image_url: shopifyProduct.imageUrl || null,
      was_available: wasAvailable,
      last_checked: new Date().toISOString(),
      restocked_at:
        !wasAvailable && isCurrentlyAvailable
          ? new Date().toISOString()
          : existingProduct?.restocked_at || null,
      variants_json: JSON.stringify(shopifyProduct.variants),
    };

    await this.db.upsertProduct(product);

    // Check if this is a restock event
    if (!wasAvailable && isCurrentlyAvailable) {
      console.log(`🎉 RESTOCK DETECTED: ${shopifyProduct.title}`);

      // Add restock event
      const eventId = `event_${generateId()}`;
      await this.db.addRestockEvent({
        id: eventId,
        product_id: product.id,
        product_title: shopifyProduct.title,
        notified: false,
      });

      return { product, event: 'restock', previousQuantity };
    }

    // Check if this product just went out of stock
    if (wasAvailable && !isCurrentlyAvailable) {
      console.log(`📉 OUT OF STOCK: ${shopifyProduct.title}`);
      return { product, event: 'out_of_stock', previousQuantity };
    }

    return { product, event: null, previousQuantity };
  }

  private async notifyRestocks(products: Product[]): Promise<void> {
    const notifications: RestockNotification[] = products.map((product) => ({
      productTitle: product.title,
      productHandle: product.handle,
      price: product.price ? `$${product.price.toFixed(2)}` : undefined,
      restockTime: product.restocked_at || new Date().toISOString(),
      inventoryQuantity: product.inventory_quantity,
      imageUrl: product.image_url || undefined,
    }));

    const successCount = await this.notification.sendBatchNotification(notifications);
    console.log(`Sent ${successCount}/${notifications.length} notifications`);

    // Mark events as notified
    const events = await this.db.getUnnotifiedEvents();
    for (const event of events) {
      await this.db.markEventAsNotified(event.id);
    }
  }

  private async notifyOutOfStock(items: { product: Product; previousQuantity: number }[]): Promise<void> {
    const notifications: OutOfStockNotification[] = items.map(({ product, previousQuantity }) => ({
      productTitle: product.title,
      productHandle: product.handle,
      price: product.price ? `$${product.price.toFixed(2)}` : undefined,
      outOfStockTime: new Date().toISOString(),
      previousQuantity,
      imageUrl: product.image_url || undefined,
    }));

    const successCount = await this.notification.sendBatchOutOfStockNotification(notifications);
    console.log(`Sent ${successCount}/${notifications.length} out-of-stock notifications`);
  }

  async sendStartupStockReport(): Promise<void> {
    const inStockProducts = await this.db.getInStockProducts();

    const items: StockReportItem[] = inStockProducts.map((product) => ({
      title: product.title,
      handle: product.handle,
      price: product.price,
      inventoryQuantity: product.inventory_quantity,
    }));

    console.log(`\n📋 Sending startup stock report (${items.length} items in stock)...`);
    await this.notification.sendStockReport(items);
  }

  async runStockReport(slot: 'midnight' | 'noon' | '4pm' | '9pm'): Promise<void> {
    const SLOT_TIMES: Record<string, string> = { midnight: '00:00', noon: '12:00', '4pm': '16:00', '9pm': '21:00' };
    const SLOT_LABELS: Record<string, string> = {
      midnight: 'Daily Report',
      noon: '12pm Stock Update',
      '4pm': '4pm Stock Update',
      '9pm': '9pm Stock Update',
    };
    const SLOT_DISPLAY: Record<string, string> = { midnight: 'midnight', noon: '12pm', '4pm': '4pm', '9pm': '9pm' };

    const date = getEasternDateString();
    const datetime = `${date} ${SLOT_TIMES[slot]}`;
    const allProducts = await this.db.getAllProducts();

    const prev = await this.db.getMostRecentSnapshotBefore(datetime);
    const previousSnapshot = prev ? await this.db.getSnapshotBySlot(prev.snapshot_date, prev.snapshot_slot) : [];
    const previousMap = new Map(previousSnapshot.map((item) => [item.shopify_id, item.inventory_quantity]));

    let previousLabel: string | null = null;
    if (prev) {
      const slotDisplay = SLOT_DISPLAY[prev.snapshot_slot] ?? prev.snapshot_slot;
      previousLabel = prev.snapshot_date !== date ? `${slotDisplay} (${prev.snapshot_date})` : slotDisplay;
    }

    const increased: StockChangeItem[] = [];
    const decreased: StockChangeItem[] = [];
    const newlyInStock: StockChangeItem[] = [];
    const outOfStock: StockChangeItem[] = [];
    let totalInStock = 0;

    for (const product of allProducts) {
      if (product.inventory_quantity > 0) totalInStock += product.inventory_quantity;

      const previousQuantity = previousMap.get(product.shopify_id) ?? 0;
      if (product.inventory_quantity === previousQuantity) continue;

      const change: StockChangeItem = {
        title: product.title,
        handle: product.handle,
        previousQuantity,
        currentQuantity: product.inventory_quantity,
      };

      if (previousQuantity === 0 && product.inventory_quantity > 0) {
        newlyInStock.push(change);
      } else if (product.inventory_quantity === 0 && previousQuantity > 0) {
        outOfStock.push(change);
      } else if (product.inventory_quantity > previousQuantity) {
        increased.push(change);
      } else {
        decreased.push(change);
      }
    }

    const report: DailyStockReport = {
      currentLabel: SLOT_LABELS[slot],
      previousLabel,
      date,
      previousDate: prev?.snapshot_date ?? null,
      increased,
      decreased,
      newlyInStock,
      outOfStock,
      totalInStock,
    };

    console.log(`\n📊 Running ${SLOT_LABELS[slot]} for ${date}${previousLabel ? ` (vs ${previousLabel})` : ''}...`);
    await this.notification.sendDailyStockReport(report);

    await this.db.saveStockSnapshot(date, slot, allProducts);
  }

  async getStatus(): Promise<{
    isRunning: boolean;
    totalProducts: number;
    restockedProducts: number;
  }> {
    const allProducts = await this.db.getAllProducts();
    const restocked = await this.db.getRestockedProducts();

    return {
      isRunning: this.isRunning,
      totalProducts: allProducts.length,
      restockedProducts: restocked.length,
    };
  }

  async getRestockHistory(limit: number = 50): Promise<Product[]> {
    return this.db.getRestockedProducts();
  }
}
