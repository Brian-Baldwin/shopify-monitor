import axios, { AxiosInstance } from 'axios';

export interface RestockNotification {
  productTitle: string;
  productHandle: string;
  price?: string;
  restockTime: string;
  inventoryQuantity?: number;
  imageUrl?: string;
}

export interface OutOfStockNotification {
  productTitle: string;
  productHandle: string;
  price?: string;
  outOfStockTime: string;
  previousQuantity?: number;
  imageUrl?: string;
}

export interface StockReportItem {
  title: string;
  handle: string;
  price: number;
  inventoryQuantity: number;
}

export interface StockChangeItem {
  title: string;
  handle: string;
  previousQuantity: number;
  currentQuantity: number;
}

export interface DailyStockReport {
  currentLabel: string;
  previousLabel: string | null;
  date: string;
  previousDate: string | null;
  increased: StockChangeItem[];
  decreased: StockChangeItem[];
  newlyInStock: StockChangeItem[];
  outOfStock: StockChangeItem[];
  totalInStock: number;
}

export class NotificationService {
  private discordWebhookUrl: string;
  private httpClient: AxiosInstance;

  constructor(discordWebhookUrl: string = '') {
    this.discordWebhookUrl = discordWebhookUrl;
    this.httpClient = axios.create({ timeout: 10000 });
  }

  async sendRestockNotification(notification: RestockNotification): Promise<boolean> {
    if (!this.discordWebhookUrl) {
      console.warn('Discord webhook URL not configured. Skipping notification for:', notification.productTitle);
      return false;
    }

    try {
      const embed = this.generateDiscordEmbed(notification);
      const payload = {
        content: '🎉 Pokemon Product Restocked!',
        embeds: [embed],
      };

      await this.httpClient.post(this.discordWebhookUrl, payload);
      console.log(`✓ Discord notification sent for: ${notification.productTitle}`);
      return true;
    } catch (error) {
      console.error('Failed to send Discord notification:', error);
      return false;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async sendBatchNotification(notifications: RestockNotification[]): Promise<number> {
    let successCount = 0;

    for (let i = 0; i < notifications.length; i++) {
      const success = await this.sendRestockNotification(notifications[i]);
      if (success) successCount++;

      // Avoid Discord webhook rate limiting (429) when many restocks fire at once
      if (i < notifications.length - 1) await this.delay(1000);
    }

    return successCount;
  }

  async sendOutOfStockNotification(notification: OutOfStockNotification): Promise<boolean> {
    if (!this.discordWebhookUrl) {
      console.warn('Discord webhook URL not configured. Skipping out-of-stock notification for:', notification.productTitle);
      return false;
    }

    try {
      const embed = this.generateOutOfStockEmbed(notification);
      const payload = {
        content: '📉 Pokemon Product Out of Stock',
        embeds: [embed],
      };

      await this.httpClient.post(this.discordWebhookUrl, payload);
      console.log(`✓ Discord out-of-stock notification sent for: ${notification.productTitle}`);
      return true;
    } catch (error) {
      console.error('Failed to send Discord out-of-stock notification:', error);
      return false;
    }
  }

  async sendBatchOutOfStockNotification(notifications: OutOfStockNotification[]): Promise<number> {
    let successCount = 0;

    for (let i = 0; i < notifications.length; i++) {
      const success = await this.sendOutOfStockNotification(notifications[i]);
      if (success) successCount++;

      if (i < notifications.length - 1) await this.delay(1000);
    }

    return successCount;
  }

  async sendStockReport(items: StockReportItem[]): Promise<boolean> {
    if (!this.discordWebhookUrl) {
      console.warn('Discord webhook URL not configured. Skipping stock report.');
      return false;
    }

    try {
      if (items.length === 0) {
        await this.httpClient.post(this.discordWebhookUrl, {
          embeds: [
            {
              title: '📋 Startup Stock Report',
              description: 'No products are currently in stock.',
              color: 0x4caf50,
              footer: { text: 'Pokemon Restock Monitor' },
              timestamp: new Date().toISOString(),
            },
          ],
        });
        console.log('✓ Discord stock report sent (nothing in stock)');
        return true;
      }

      const lines = items.map(
        (item) =>
          `**[${item.title}](https://princedist.com/products/${item.handle})** — ${item.inventoryQuantity} in stock — $${item.price.toFixed(2)}`
      );

      const MAX_CHUNK_LENGTH = 3800;
      const chunks: string[] = [];
      let currentChunk = '';

      for (const line of lines) {
        const candidate = currentChunk ? `${currentChunk}\n${line}` : line;
        if (candidate.length > MAX_CHUNK_LENGTH && currentChunk) {
          chunks.push(currentChunk);
          currentChunk = line;
        } else {
          currentChunk = candidate;
        }
      }
      if (currentChunk) {
        chunks.push(currentChunk);
      }

      for (let i = 0; i < chunks.length; i++) {
        const embed: any = {
          description: chunks[i],
          color: 0x4caf50,
          footer: { text: 'Pokemon Restock Monitor' },
          timestamp: new Date().toISOString(),
        };

        if (i === 0) {
          embed.title = `📋 Startup Stock Report (${items.length} in stock)`;
        }

        await this.httpClient.post(this.discordWebhookUrl, { embeds: [embed] });

        if (i < chunks.length - 1) await this.delay(1000);
      }

      console.log(`✓ Discord stock report sent (${items.length} items, ${chunks.length} message(s))`);
      return true;
    } catch (error) {
      console.error('Failed to send Discord stock report:', error);
      return false;
    }
  }

  async sendDailyStockReport(report: DailyStockReport): Promise<boolean> {
    if (!this.discordWebhookUrl) {
      console.warn('Discord webhook URL not configured. Skipping daily stock report.');
      return false;
    }

    const titleSuffix = report.previousLabel ? ` (vs ${report.previousLabel})` : '';
    const title = `📊 ${report.currentLabel} — ${report.date}${titleSuffix}`;
    const summary = `Total in stock: **${report.totalInStock}**`;

    try {
      const productLink = (item: StockChangeItem) => `[${item.title}](https://princedist.com/products/${item.handle})`;
      const delta = (item: StockChangeItem) => {
        const d = item.currentQuantity - item.previousQuantity;
        return d >= 0 ? `+${d}` : `${d}`;
      };

      const sections: string[] = [];

      if (report.newlyInStock.length > 0) {
        sections.push(
          `**🆕 Newly In Stock (${report.newlyInStock.length})**\n` +
            report.newlyInStock
              .map((item) => `${productLink(item)} — 0 → ${item.currentQuantity} (${delta(item)})`)
              .join('\n')
        );
      }

      if (report.increased.length > 0) {
        sections.push(
          `**📈 Increased (${report.increased.length})**\n` +
            report.increased
              .map((item) => `${productLink(item)} — ${item.previousQuantity} → ${item.currentQuantity} (${delta(item)})`)
              .join('\n')
        );
      }

      if (report.decreased.length > 0) {
        sections.push(
          `**📉 Decreased (${report.decreased.length})**\n` +
            report.decreased
              .map((item) => `${productLink(item)} — ${item.previousQuantity} → ${item.currentQuantity} (${delta(item)})`)
              .join('\n')
        );
      }

      if (report.outOfStock.length > 0) {
        sections.push(
          `**❌ Out of Stock (${report.outOfStock.length})**\n` +
            report.outOfStock
              .map((item) => `${productLink(item)} — ${item.previousQuantity} → 0 (${delta(item)})`)
              .join('\n')
        );
      }

      if (sections.length === 0) {
        await this.httpClient.post(this.discordWebhookUrl, {
          embeds: [
            {
              title,
              description: report.previousLabel
                ? `No changes since ${report.previousLabel}.\n\n${summary}`
                : `No previous snapshot to compare against.\n\n${summary}`,
              color: 0x5865f2,
              footer: { text: 'Pokemon Restock Monitor' },
              timestamp: new Date().toISOString(),
            },
          ],
        });
        console.log('✓ Discord daily stock report sent (no changes)');
        return true;
      }

      const MAX_CHUNK_LENGTH = 3800;
      const chunks: string[] = [];
      let currentChunk = '';

      for (const section of sections) {
        const candidate = currentChunk ? `${currentChunk}\n\n${section}` : section;
        if (candidate.length > MAX_CHUNK_LENGTH && currentChunk) {
          chunks.push(currentChunk);
          currentChunk = section;
        } else {
          currentChunk = candidate;
        }
      }
      if (currentChunk) {
        chunks.push(currentChunk);
      }

      for (let i = 0; i < chunks.length; i++) {
        const isLast = i === chunks.length - 1;
        const embed: any = {
          description: isLast ? `${chunks[i]}\n\n${summary}` : chunks[i],
          color: 0x5865f2,
          footer: { text: 'Pokemon Restock Monitor' },
          timestamp: new Date().toISOString(),
        };

        if (i === 0) {
          embed.title = title;
        }

        await this.httpClient.post(this.discordWebhookUrl, { embeds: [embed] });

        if (!isLast) await this.delay(1000);
      }

      console.log(`✓ Discord daily stock report sent (${chunks.length} message(s))`);
      return true;
    } catch (error) {
      console.error('Failed to send Discord daily stock report:', error);
      return false;
    }
  }

  private generateDiscordEmbed(notification: RestockNotification): any {
    const productUrl = `https://princedist.com/products/${notification.productHandle}`;

    return {
      title: notification.productTitle,
      description: '✅ Back in stock!',
      color: 0xff6b35,
      fields: [
        {
          name: 'Product Link',
          value: `[Buy Now](${productUrl})`,
          inline: false,
        },
        ...(notification.price ? [
          {
            name: 'Price',
            value: notification.price,
            inline: true,
          },
        ] : []),
        ...(notification.inventoryQuantity !== undefined ? [
          {
            name: 'Stock',
            value: `${notification.inventoryQuantity} units`,
            inline: true,
          },
        ] : []),
        {
          name: 'Restocked At',
          value: new Date(notification.restockTime).toLocaleString(),
          inline: true,
        },
      ],
      thumbnail: notification.imageUrl
        ? { url: notification.imageUrl }
        : {
            url: 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/25.png',
          },
      footer: {
        text: 'Pokemon Restock Monitor',
      },
      timestamp: new Date().toISOString(),
    };
  }

  private generateOutOfStockEmbed(notification: OutOfStockNotification): any {
    const productUrl = `https://princedist.com/products/${notification.productHandle}`;

    return {
      title: notification.productTitle,
      description: '❌ Out of stock',
      color: 0xed4245,
      fields: [
        {
          name: 'Product Link',
          value: `[View Product](${productUrl})`,
          inline: false,
        },
        ...(notification.price ? [
          {
            name: 'Price',
            value: notification.price,
            inline: true,
          },
        ] : []),
        ...(notification.previousQuantity !== undefined ? [
          {
            name: 'Previous Stock',
            value: `${notification.previousQuantity} units`,
            inline: true,
          },
        ] : []),
        {
          name: 'Went Out of Stock At',
          value: new Date(notification.outOfStockTime).toLocaleString(),
          inline: true,
        },
      ],
      thumbnail: notification.imageUrl
        ? { url: notification.imageUrl }
        : {
            url: 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/25.png',
          },
      footer: {
        text: 'Pokemon Restock Monitor',
      },
      timestamp: new Date().toISOString(),
    };
  }

  async verifyConnection(): Promise<boolean> {
    if (!this.discordWebhookUrl) {
      console.warn('⚠ Discord webhook URL not configured');
      return false;
    }

    try {
      const testPayload = {
        content: '✓ Pokemon Monitor webhook verification successful',
      };
      await this.httpClient.post(this.discordWebhookUrl, testPayload);
      console.log('✓ Discord webhook verified and ready');
      return true;
    } catch (error) {
      console.error('✗ Discord webhook verification failed:', error);
      return false;
    }
  }
}
