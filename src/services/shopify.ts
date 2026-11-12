import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { EXTRA_CA_CERTS } from './trustedCerts';
import { ProxyConfig, ProxyManager } from './proxyManager';

export interface ShopifyVariant {
  id: string;
  title: string;
  price: string;
  available: boolean;
  inventoryQuantity?: number;
}

export interface ShopifyProduct {
  id: string;
  title: string;
  handle: string;
  variants: ShopifyVariant[];
  imageUrl?: string;
  priceRange?: {
    minVariantPrice?: {
      amount: string;
    };
  };
}

export class ShopifyService {
  private storeUrl: string;
  private apiClient: AxiosInstance;
  private proxyManager: ProxyManager;

  /**
   * Initialize a client for the store's public products.json endpoints.
   * These are exposed by default on Shopify storefronts, so no Storefront
   * API token or admin access is required.
   *
   * If `proxies` is non-empty, requests that get a 429 are retried through
   * the next proxy in the list instead of just backing off.
   */
  constructor(storeUrl: string = 'https://princedist.com', proxies: ProxyConfig[] = []) {
    this.storeUrl = storeUrl.replace(/\/$/, '');
    // princedist.com's certificate chain relies on intermediates Node
    // doesn't bundle by default; see trustedCerts.ts for details.
    this.proxyManager = new ProxyManager(proxies, EXTRA_CA_CERTS);

    this.apiClient = axios.create({
      baseURL: this.storeUrl,
      // Without a timeout, a single connection that Cloudflare/the network
      // never responds to (no error, no data) hangs forever - since checks
      // run sequentially, that permanently freezes all future monitoring.
      timeout: 20000,
      headers: {
        // Cloudflare blocks requests with non-browser User-Agents (403)
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });
  }

  async getPokemonProducts(): Promise<ShopifyProduct[]> {
    let products = await this.fetchProducts('/collections/pokemon/products.json');

    if (products.length === 0) {
      // Fallback: filter the full catalog for Pokemon products
      const allProducts = await this.fetchProducts('/products.json');
      products = allProducts.filter((product) =>
        product.title.toLowerCase().includes('pokemon')
      );
    }

    // Only fetch per-product pages for items that are actually in stock -
    // querying all ~250 products triggers Cloudflare rate limiting (429s).
    for (const product of products) {
      const hasAvailableVariant = product.variants.some((v) => v.available);
      if (!hasAvailableVariant) {
        for (const variant of product.variants) {
          variant.inventoryQuantity = 0;
        }
        continue;
      }

      const quantities = await this.fetchInventoryQuantities(product.handle);
      for (const variant of product.variants) {
        variant.inventoryQuantity = quantities.get(variant.id) ?? 0;
      }

      // Be gentle with Cloudflare between requests
      await this.delay(500);
    }

    return products;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Runs a request, retrying on 429. If a proxy list is configured, each
   * retry rotates to the next proxy so the rate limit is hit from a
   * different IP; otherwise it falls back to a fixed delay-and-retry.
   */
  private async requestWithRetry<T>(
    fn: (config: { httpsAgent: any }) => Promise<T>
  ): Promise<T> {
    const maxAttempts = this.proxyManager.enabled ? this.proxyManager.size + 1 : 2;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn({ httpsAgent: this.proxyManager.getAgent() });
      } catch (error) {
        const status = (error as any)?.response?.status;
        if (status === 429 && attempt < maxAttempts) {
          if (this.proxyManager.enabled) {
            this.proxyManager.rotate();
          } else {
            await this.delay(2000);
          }
          continue;
        }
        throw error;
      }
    }

    throw new Error('unreachable');
  }

  /**
   * Reads per-variant stock counts from the "Back in Stock" app's
   * bis-variant-data JSON embedded on each product page. This is publicly
   * accessible and not exposed by the products.json feed.
   */
  private async fetchInventoryQuantities(handle: string): Promise<Map<string, number>> {
    const quantities = new Map<string, number>();

    try {
      const response = await this.requestWithRetry((config) =>
        this.apiClient.get(`/products/${handle}`, config)
      );
      const html: string = response.data;

      const match = html.match(
        /<script[^>]*id="bis-variant-data"[^>]*>([\s\S]*?)<\/script>/
      );
      if (!match) {
        return quantities;
      }

      const variants = JSON.parse(match[1]);
      for (const variant of variants) {
        quantities.set(variant.id?.toString() || '', variant.inventory_quantity ?? 0);
      }
    } catch (error) {
      console.error(`Error fetching inventory for ${handle}:`, error);
    }

    return quantities;
  }

  async verifyConnection(): Promise<boolean> {
    try {
      await this.requestWithRetry((config) =>
        this.apiClient.get('/products.json', { params: { limit: 1 }, ...config })
      );
      return true;
    } catch (error) {
      console.error('Error connecting to store:', error);
      return false;
    }
  }

  private async fetchProducts(endpoint: string): Promise<ShopifyProduct[]> {
    const allProducts: ShopifyProduct[] = [];
    let page = 1;

    while (true) {
      try {
        const response: AxiosResponse = await this.requestWithRetry((config) =>
          this.apiClient.get(endpoint, { params: { limit: 250, page }, ...config })
        );

        const products = response.data.products || [];
        allProducts.push(...products.map((product: any) => this.parseProduct(product)));

        if (products.length < 250) break;
        page++;
      } catch (error) {
        console.error(`Error fetching ${endpoint} (page ${page}):`, error);
        // A failure on page 1 means we got nothing at all - surface it as an
        // error instead of silently reporting an empty/healthy check. A
        // failure on a later page still keeps whatever was already fetched.
        if (allProducts.length === 0) throw error;
        break;
      }
    }

    return allProducts;
  }

  private parseProduct(product: any): ShopifyProduct {
    const variants: ShopifyVariant[] = (product.variants || []).map((variant: any) => ({
      id: variant.id?.toString() || '',
      title: variant.title || '',
      price: variant.price?.toString() || '0',
      available: variant.available === true,
    }));

    return {
      id: product.id?.toString() || '',
      title: product.title || '',
      handle: product.handle || '',
      variants,
      imageUrl: product.images?.[0]?.src,
      priceRange: {
        minVariantPrice: {
          amount: variants[0]?.price || '0',
        },
      },
    };
  }
}
