import fs from 'fs';
import https from 'https';
import tls from 'tls';
import createHttpsProxyAgent from 'https-proxy-agent';

const HttpsProxyAgentClass = createHttpsProxyAgent.HttpsProxyAgent;

export interface ProxyConfig {
  host: string;
  port: number;
  username?: string;
  password?: string;
}

/**
 * https-proxy-agent doesn't forward the agent's TLS options (e.g. `ca`) to
 * the connection it makes to the target server through the proxy tunnel, so
 * we inject the trusted CA certs ourselves on every request.
 */
class TrustedProxyAgent extends HttpsProxyAgentClass {
  constructor(opts: any, private extraCa: (string | Buffer)[]) {
    super(opts);
  }

  callback(req: any, opts: any) {
    return super.callback(req, { ...opts, ca: this.extraCa });
  }
}

/**
 * Parses a single proxy list entry. Supported formats:
 *   host:port
 *   host:port:username:password   (the most common proxy-list format)
 *   http://username:password@host:port
 */
export function parseProxyEntry(entry: string): ProxyConfig | null {
  const trimmed = entry.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      return {
        host: url.hostname,
        port: parseInt(url.port, 10) || 80,
        username: url.username ? decodeURIComponent(url.username) : undefined,
        password: url.password ? decodeURIComponent(url.password) : undefined,
      };
    } catch {
      console.warn(`⚠ Ignoring malformed proxy URL: ${entry}`);
      return null;
    }
  }

  const parts = trimmed.split(':');
  if (parts.length === 2) {
    const [host, port] = parts;
    return { host, port: parseInt(port, 10) };
  }
  if (parts.length === 4) {
    const [host, port, username, password] = parts;
    return { host, port: parseInt(port, 10), username, password };
  }

  console.warn(`⚠ Ignoring malformed proxy entry: ${entry}`);
  return null;
}

/**
 * Loads proxies from PROXY_LIST (comma/newline separated entries) and/or
 * PROXY_LIST_FILE (a file with one proxy per line). Both are optional - if
 * neither is set, an empty list is returned and requests go out directly.
 */
export function loadProxiesFromEnv(): ProxyConfig[] {
  const entries: string[] = [];

  if (process.env.PROXY_LIST) {
    entries.push(...process.env.PROXY_LIST.split(/[\n,]/));
  }

  if (process.env.PROXY_LIST_FILE) {
    try {
      const contents = fs.readFileSync(process.env.PROXY_LIST_FILE, 'utf-8');
      entries.push(...contents.split('\n'));
    } catch (error) {
      console.warn(`⚠ Could not read PROXY_LIST_FILE: ${error}`);
    }
  }

  const proxies: ProxyConfig[] = [];
  for (const entry of entries) {
    const proxy = parseProxyEntry(entry);
    if (proxy) proxies.push(proxy);
  }

  return proxies;
}

/**
 * Hands out an HTTPS agent for outgoing requests. With no proxies configured
 * it always returns a direct agent. With proxies configured, requests use
 * the current proxy and rotate() advances to the next one - used when a 429
 * is detected so subsequent retries come from a different IP.
 */
export class ProxyManager {
  private proxies: ProxyConfig[];
  private agents: any[];
  private directAgent: https.Agent;
  private currentIndex = 0;

  constructor(proxies: ProxyConfig[], extraCaCerts: string[]) {
    this.proxies = proxies;
    const ca = [...tls.rootCertificates, ...extraCaCerts];
    this.directAgent = new https.Agent({ ca });
    this.agents = proxies.map((proxy) => {
      const auth = proxy.username ? `${proxy.username}:${proxy.password ?? ''}` : undefined;
      return new TrustedProxyAgent(
        {
          protocol: 'http:',
          host: proxy.host,
          port: proxy.port,
          auth,
        },
        ca
      );
    });

    if (proxies.length > 0) {
      console.log(`✓ Loaded ${proxies.length} prox${proxies.length === 1 ? 'y' : 'ies'} for rate-limit fallback`);
    }
  }

  get enabled(): boolean {
    return this.proxies.length > 0;
  }

  get size(): number {
    return this.proxies.length;
  }

  /** Returns the agent to use for the current attempt. */
  getAgent(): https.Agent | any {
    if (!this.enabled) return this.directAgent;
    return this.agents[this.currentIndex];
  }

  /** Switches to the next proxy in the list (called after a 429). */
  rotate(): void {
    if (!this.enabled) return;
    this.currentIndex = (this.currentIndex + 1) % this.proxies.length;
    console.log(`🔄 Rate limited - switching to proxy ${this.currentIndex + 1}/${this.proxies.length}`);
  }
}
