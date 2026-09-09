// apps/api/src/security/safe-connector.ts
import dns from 'dns';
import net from 'net';
import { EgressTargetPolicy } from './egress-policies';

export interface PinnedEgressTarget {
  targetUrl: string;
  hostname: string;
  port: number;
  protocol: string;
  pinnedIp: string;
  resolvedIps: string[];
  pathname: string;
  search: string;
  pinnedUrl: string;
}

export class SafeConnector {
  /**
   * Validates target URL against given policy, resolves DNS records,
   * enforces IP & port restrictions against all resolved records to prevent
   * DNS rebinding attacks, and pins destination IP for safe outbound transmission.
   */
  public static async validateAndPin(
    targetUrl: string,
    policy: EgressTargetPolicy
  ): Promise<PinnedEgressTarget> {
    let parsed: URL;
    try {
      parsed = new URL(targetUrl);
    } catch (err: any) {
      throw new Error(`SSRF_EGRESS_BLOCKED: Invalid URL format: ${err.message}`);
    }

    // Protocol enforcement: Only http and https
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(
        `SSRF_EGRESS_BLOCKED: Protocol ${parsed.protocol} is prohibited. Only http: and https: are allowed.`
      );
    }

    // Port resolution
    const port = parsed.port
      ? parseInt(parsed.port, 10)
      : parsed.protocol === 'https:'
      ? 443
      : 80;

    if (isNaN(port) || port <= 0 || port > 65535) {
      throw new Error(`SSRF_EGRESS_BLOCKED: Invalid port number: ${parsed.port}`);
    }

    if (!policy.validatePort(port)) {
      throw new Error(`SSRF_EGRESS_BLOCKED: Outbound port ${port} is prohibited by egress security policy`);
    }

    // Clean brackets around IPv6 literal hostnames (e.g. [::1] -> ::1)
    const rawHostname = parsed.hostname;
    const cleanHostname =
      rawHostname.startsWith('[') && rawHostname.endsWith(']')
        ? rawHostname.slice(1, -1)
        : rawHostname;

    let addresses: { address: string; family: number }[] = [];

    // If already literal IP, bypass DNS lookup
    if (net.isIP(cleanHostname)) {
      addresses = [{ address: cleanHostname, family: net.isIP(cleanHostname) }];
    } else {
      try {
        addresses = await dns.promises.lookup(cleanHostname, { all: true });
      } catch (err: any) {
        throw new Error(
          `SSRF_EGRESS_BLOCKED: DNS resolution failed for hostname ${cleanHostname}: ${err.message}`
        );
      }
    }

    if (!addresses || addresses.length === 0) {
      throw new Error(`SSRF_EGRESS_BLOCKED: Hostname ${cleanHostname} resolved to 0 IP addresses`);
    }

    // Anti-DNS-Rebinding Invariant: EVERY resolved IP must satisfy the policy!
    for (const record of addresses) {
      const isValid = policy.validateIp(record.address);
      if (!isValid) {
        throw new Error(
          `SSRF_EGRESS_BLOCKED: Destination IP ${record.address} is prohibited by egress security policy`
        );
      }
    }

    // Pin the first verified IP
    const pinnedIp = addresses[0].address;
    const isIpv6 = net.isIP(pinnedIp) === 6;
    const formattedHost = isIpv6 ? `[${pinnedIp}]` : pinnedIp;
    const pinnedUrl = `${parsed.protocol}//${formattedHost}:${port}${parsed.pathname}${parsed.search}`;

    return {
      targetUrl,
      hostname: cleanHostname,
      port,
      protocol: parsed.protocol,
      pinnedIp,
      resolvedIps: addresses.map((a) => a.address),
      pathname: parsed.pathname,
      search: parsed.search,
      pinnedUrl
    };
  }

  /**
   * Connect helper returning pinned egress target and ready socket connection options.
   */
  public static async connect(
    targetUrl: string,
    policy: EgressTargetPolicy,
    options?: { timeoutMs?: number; headers?: Record<string, string> }
  ): Promise<PinnedEgressTarget> {
    return this.validateAndPin(targetUrl, policy);
  }

  /**
   * Low-level pinned HTTP/HTTPS fetch preventing DNS rebinding and enforcing
   * a strict 5-second timeout and manual redirect prohibition.
   */
  public static async fetch(
    targetUrl: string,
    policy: EgressTargetPolicy,
    init?: RequestInit
  ): Promise<Response> {
    const pinned = await this.validateAndPin(targetUrl, policy);

    const headers = new Headers(init?.headers);
    if (!headers.has('Host')) {
      headers.set('Host', pinned.hostname);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      return await fetch(pinned.pinnedUrl, {
        ...init,
        headers,
        signal: controller.signal,
        redirect: 'manual'
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}
