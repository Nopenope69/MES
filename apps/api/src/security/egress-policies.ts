// apps/api/src/security/egress-policies.ts
import net from 'net';

/**
 * Contract for evaluating whether an outbound egress destination (IP & port)
 * is permitted under industrial factory security controls.
 */
export interface EgressTargetPolicy {
  validateIp(ip: string): boolean;
  validatePort(port: number): boolean;
}

/**
 * Tests whether an IPv4 address belongs to RFC 1918, RFC 3927 link-local,
 * loopback (127.0.0.0/8), cloud metadata (169.254.169.254), or other reserved/private ranges.
 */
export function isPrivateOrRestrictedIpv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
    return true; // Invalid format is blocked
  }
  const [a, b, c] = parts;

  // 0.0.0.0/8 (Current network)
  if (a === 0) return true;
  // 10.0.0.0/8 (RFC 1918 Private)
  if (a === 10) return true;
  // 127.0.0.0/8 (Loopback)
  if (a === 127) return true;
  // 169.254.0.0/16 (RFC 3927 Link-Local & Cloud Metadata 169.254.169.254)
  if (a === 169 && b === 254) return true;
  // 172.16.0.0/12 (RFC 1918 Private: 172.16.0.0 - 172.31.255.255)
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16 (RFC 1918 Private)
  if (a === 192 && b === 168) return true;
  // 100.64.0.0/10 (Carrier-Grade NAT)
  if (a === 100 && b >= 64 && b <= 127) return true;
  // 192.0.0.0/24 (IETF Protocol Assignments)
  if (a === 192 && b === 0 && c === 0) return true;
  // 192.0.2.0/24 (TEST-NET-1)
  if (a === 192 && b === 0 && c === 2) return true;
  // 198.18.0.0/15 (Network Benchmark Tests)
  if (a === 198 && (b === 18 || b === 19)) return true;
  // 198.51.100.0/24 (TEST-NET-2)
  if (a === 198 && b === 51 && c === 100) return true;
  // 203.0.113.0/24 (TEST-NET-3)
  if (a === 203 && b === 0 && c === 113) return true;
  // 224.0.0.0/4 (Multicast)
  if (a >= 224 && a <= 239) return true;
  // 240.0.0.0/4 (Reserved / Future Use) & 255.255.255.255
  if (a >= 240) return true;

  return false;
}

/**
 * Tests whether an IPv6 address belongs to loopback (::1), link-local (fe80::/10),
 * unique local / cloud metadata (fc00::/7, fd00::/8, fd00:ec2::254), or IPv4-mapped IPv6 (::ffff:...).
 */
export function isPrivateOrRestrictedIpv6(ip: string): boolean {
  const lower = ip.toLowerCase().trim();

  // IPv4-mapped IPv6 (::ffff:x.x.x.x or ::ffff:xxxx:xxxx)
  if (lower.startsWith('::ffff:') || lower.startsWith('0:0:0:0:0:ffff:')) {
    return true;
  }

  // IPv6 Loopback (::1)
  if (lower === '::1' || lower === '0:0:0:0:0:0:0:1' || /^0*(:0*){7}1$/.test(lower)) {
    return true;
  }

  // IPv6 Unspecified (::)
  if (lower === '::' || lower === '0:0:0:0:0:0:0:0' || /^0*(:0*)*$/.test(lower)) {
    return true;
  }

  // Link-Local (fe80::/10)
  if (/^fe[89ab][0-9a-f]/i.test(lower)) {
    return true;
  }

  // Unique Local Address (fc00::/7, including fd00::/8 and fd00:ec2::254 AWS IMDSv6)
  if (/^f[cd][0-9a-f]{2}:/i.test(lower) || lower.startsWith('fc') || lower.startsWith('fd')) {
    return true;
  }

  // Cloud metadata explicit check
  if (lower.includes('fd00:ec2::254')) {
    return true;
  }

  return false;
}

/**
 * Checks whether an IPv4 address falls within a CIDR block (e.g. 192.168.10.0/24).
 */
export function isIpInCidr(ip: string, cidr: string): boolean {
  const [network, prefixStr] = cidr.split('/');
  if (!prefixStr) {
    return ip === network;
  }
  const prefix = parseInt(prefixStr, 10);
  if (isNaN(prefix) || prefix < 0 || prefix > 32) return false;

  const ipParts = ip.split('.').map((p) => parseInt(p, 10));
  const netParts = network.split('.').map((p) => parseInt(p, 10));
  if (ipParts.length !== 4 || netParts.length !== 4) return false;

  const ipNum = ((ipParts[0] << 24) | (ipParts[1] << 16) | (ipParts[2] << 8) | ipParts[3]) >>> 0;
  const netNum = ((netParts[0] << 24) | (netParts[1] << 16) | (netParts[2] << 8) | netParts[3]) >>> 0;

  if (prefix === 0) return true;
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  return (ipNum & mask) === (netNum & mask);
}

/**
 * WebhookTargetPolicy:
 * Rejects RFC 1918 private IPv4 (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16),
 * RFC 3927 link-local (169.254.0.0/16), loopback (127.0.0.0/8, ::1),
 * cloud metadata (169.254.169.254, fd00:ec2::254), and IPv4-mapped IPv6 (::ffff:...).
 * Allows only standard outbound web ports (80 and 443).
 */
export class WebhookTargetPolicy implements EgressTargetPolicy {
  validateIp(ip: string): boolean {
    const clean = ip.trim().toLowerCase();
    const family = net.isIP(clean);

    if (family === 4) {
      return !isPrivateOrRestrictedIpv4(clean);
    }
    if (family === 6) {
      return !isPrivateOrRestrictedIpv6(clean);
    }
    return false;
  }

  validatePort(port: number): boolean {
    return port === 80 || port === 443;
  }
}

/**
 * InternalServiceTargetPolicy:
 * Allows designated factory/OT subnets for internal machine integrations (e.g. Fuji Nexim, AOI/SPI).
 */
export class InternalServiceTargetPolicy implements EgressTargetPolicy {
  private allowedSubnets: string[];
  private allowedPorts: Set<number>;

  constructor(options?: { allowedSubnets?: string[]; allowedPorts?: number[] }) {
    this.allowedSubnets = options?.allowedSubnets ?? [
      '127.0.0.1',
      '::1',
      '10.0.0.0/8',
      '172.16.0.0/12',
      '192.168.0.0/16',
      '192.168.10.0/24'
    ];
    this.allowedPorts = new Set(options?.allowedPorts ?? [80, 443, 4000, 8080, 30040, 5432]);
  }

  validateIp(ip: string): boolean {
    const clean = ip.trim().toLowerCase();
    return this.allowedSubnets.some((subnet) => {
      if (subnet.includes('/')) {
        return isIpInCidr(clean, subnet);
      }
      return clean === subnet.toLowerCase();
    });
  }

  validatePort(port: number): boolean {
    return this.allowedPorts.has(port);
  }
}
