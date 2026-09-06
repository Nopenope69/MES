/**
 * OT Industrial Subnet & IP Firewall
 * Secures high-speed TCP socket connections (e.g. Fuji Nexim port 30040)
 * by enforcing ISA-95 Level 2/3 network segmentation.
 */

export class IpFirewall {
  /**
   * Normalizes an IP string, stripping IPv4-mapped IPv6 prefixes (e.g. ::ffff:192.168.1.1).
   */
  public static normalizeIp(ip: string): string {
    if (!ip) return '';
    let clean = ip.trim();
    if (clean.startsWith('::ffff:')) {
      clean = clean.substring(7);
    }
    return clean;
  }

  /**
   * Converts an IPv4 address string to a 32-bit unsigned integer.
   */
  private static ipv4ToNumber(ip: string): number | null {
    const parts = ip.split('.');
    if (parts.length !== 4) return null;
    let num = 0;
    for (let i = 0; i < 4; i++) {
      const part = parseInt(parts[i], 10);
      if (isNaN(part) || part < 0 || part > 255) return null;
      num = (num << 8) + part;
    }
    return num >>> 0;
  }

  /**
   * Evaluates whether an IPv4 address falls within a given CIDR block (e.g., 192.168.10.0/24).
   */
  public static isIpInCidr(ip: string, cidr: string): boolean {
    const [range, bitsStr] = cidr.split('/');
    if (!bitsStr) {
      return this.normalizeIp(ip) === this.normalizeIp(range);
    }

    const prefixBits = parseInt(bitsStr, 10);
    if (isNaN(prefixBits) || prefixBits < 0 || prefixBits > 32) return false;

    const ipNum = this.ipv4ToNumber(this.normalizeIp(ip));
    const rangeNum = this.ipv4ToNumber(this.normalizeIp(range));
    if (ipNum === null || rangeNum === null) return false;

    if (prefixBits === 0) return true;
    const mask = ((0xffffffff << (32 - prefixBits)) >>> 0);
    return (ipNum & mask) === (rangeNum & mask);
  }

  /**
   * Authorizes whether a client IP is allowed based on configured subnet whitelist.
   */
  public static isAllowed(clientIp: string, allowedRules: string[]): boolean {
    const cleanIp = this.normalizeIp(clientIp);
    if (!cleanIp) return false;

    // Direct loopback matches
    if (cleanIp === '127.0.0.1' || cleanIp === '::1' || cleanIp === 'localhost') {
      if (allowedRules.includes('127.0.0.1') || allowedRules.includes('::1') || allowedRules.includes('localhost')) {
        return true;
      }
    }

    for (const rule of allowedRules) {
      const trimmed = rule.trim();
      if (!trimmed) continue;

      // Exact IP match
      if (trimmed === cleanIp) return true;

      // CIDR block match
      if (trimmed.includes('/')) {
        if (this.isIpInCidr(cleanIp, trimmed)) {
          return true;
        }
      }
    }

    return false;
  }
}
