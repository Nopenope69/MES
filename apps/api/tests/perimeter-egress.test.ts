import { describe, it, expect, beforeEach, vi } from 'vitest';
import dns from 'dns';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { app } from '../src/server';
import { initDatabase, getDatabase } from '../src/db/database';
import { SafeConnector } from '../src/security/safe-connector';
import {
  WebhookTargetPolicy,
  InternalServiceTargetPolicy
} from '../src/security/egress-policies';
import { OnboardingService } from '../src/services/onboarding.service';

describe('Perimeter, SafeConnector & Egress Policy Suite (Task 6)', () => {
  const rootDir = path.resolve(__dirname, '../../..');

  describe('1. Outbound SSRF Defense & Egress Policies', () => {
    it('rejects outbound webhook connections to private RFC1918, link-local, and IPv4-mapped IPv6 ranges', async () => {
      const policy = new WebhookTargetPolicy();

      // Cloud Metadata & Link-Local IPv4
      await expect(
        SafeConnector.validateAndPin('http://169.254.169.254/latest/meta-data', policy)
      ).rejects.toThrow('SSRF_EGRESS_BLOCKED');

      // RFC 1918 10.0.0.0/8
      await expect(
        SafeConnector.validateAndPin('http://10.0.1.50/api/webhook', policy)
      ).rejects.toThrow('SSRF_EGRESS_BLOCKED');

      // RFC 1918 172.16.0.0/12
      await expect(
        SafeConnector.validateAndPin('http://172.16.31.254/callback', policy)
      ).rejects.toThrow('SSRF_EGRESS_BLOCKED');

      // RFC 1918 192.168.0.0/16
      await expect(
        SafeConnector.validateAndPin('http://192.168.10.1:80/webhook', policy)
      ).rejects.toThrow('SSRF_EGRESS_BLOCKED');

      // Loopback IPv4
      await expect(
        SafeConnector.validateAndPin('http://127.0.0.1/webhook', policy)
      ).rejects.toThrow('SSRF_EGRESS_BLOCKED');

      // Loopback IPv6
      await expect(
        SafeConnector.validateAndPin('http://[::1]/webhook', policy)
      ).rejects.toThrow('SSRF_EGRESS_BLOCKED');

      // IPv4-mapped IPv6
      await expect(
        SafeConnector.validateAndPin('http://[::ffff:169.254.169.254]/meta', policy)
      ).rejects.toThrow('SSRF_EGRESS_BLOCKED');

      await expect(
        SafeConnector.validateAndPin('http://[::ffff:127.0.0.1]/status', policy)
      ).rejects.toThrow('SSRF_EGRESS_BLOCKED');

      await expect(
        SafeConnector.validateAndPin('http://[::ffff:10.0.0.1]/data', policy)
      ).rejects.toThrow('SSRF_EGRESS_BLOCKED');

      // AWS IMDSv6 Cloud Metadata (fd00:ec2::254)
      await expect(
        SafeConnector.validateAndPin('http://[fd00:ec2::254]/latest/meta-data', policy)
      ).rejects.toThrow('SSRF_EGRESS_BLOCKED');

      // Non-whitelisted egress ports (Webhook policy only allows 80 and 443)
      await expect(
        SafeConnector.validateAndPin('http://93.184.216.34:22/ssh', policy)
      ).rejects.toThrow('SSRF_EGRESS_BLOCKED');

      await expect(
        SafeConnector.validateAndPin('http://93.184.216.34:8080/admin', policy)
      ).rejects.toThrow('SSRF_EGRESS_BLOCKED');

      // Unsupported protocol schemes
      await expect(
        SafeConnector.validateAndPin('ftp://93.184.216.34/file', policy)
      ).rejects.toThrow('SSRF_EGRESS_BLOCKED');

      await expect(
        SafeConnector.validateAndPin('file:///etc/passwd', policy)
      ).rejects.toThrow('SSRF_EGRESS_BLOCKED');
    });

    it('validates and pins outbound connections to legitimate public IPs', async () => {
      const policy = new WebhookTargetPolicy();

      // Literal public IPv4
      const pinnedV4 = await SafeConnector.validateAndPin('http://93.184.216.34/webhook', policy);
      expect(pinnedV4.pinnedIp).toBe('93.184.216.34');
      expect(pinnedV4.hostname).toBe('93.184.216.34');
      expect(pinnedV4.port).toBe(80);
      expect(pinnedV4.protocol).toBe('http:');
      expect(pinnedV4.pinnedUrl).toBe('http://93.184.216.34:80/webhook');
      expect(pinnedV4.resolvedIps).toContain('93.184.216.34');

      const pinnedHttps = await SafeConnector.validateAndPin('https://1.1.1.1/dns-query', policy);
      expect(pinnedHttps.pinnedIp).toBe('1.1.1.1');
      expect(pinnedHttps.port).toBe(443);
      expect(pinnedHttps.protocol).toBe('https:');
      expect(pinnedHttps.pinnedUrl).toBe('https://1.1.1.1:443/dns-query');

      // Domain name resolution with DNS lookup pinning
      const dnsSpy = vi.spyOn(dns.promises, 'lookup').mockResolvedValueOnce([
        { address: '93.184.216.34', family: 4 }
      ] as any);

      const pinnedDomain = await SafeConnector.validateAndPin(
        'https://erp.factory-enterprise.com/api/v1/shipment',
        policy
      );
      expect(pinnedDomain.pinnedIp).toBe('93.184.216.34');
      expect(pinnedDomain.hostname).toBe('erp.factory-enterprise.com');
      expect(pinnedDomain.port).toBe(443);
      expect(pinnedDomain.pinnedUrl).toBe('https://93.184.216.34:443/api/v1/shipment');
      dnsSpy.mockRestore();

      // Anti-DNS-Rebinding: If any resolved IP is private, whole request is blocked
      const rebindingSpy = vi.spyOn(dns.promises, 'lookup').mockResolvedValueOnce([
        { address: '93.184.216.34', family: 4 },
        { address: '127.0.0.1', family: 4 }
      ] as any);

      await expect(
        SafeConnector.validateAndPin('https://attacker-rebinding.com/steal', policy)
      ).rejects.toThrow('SSRF_EGRESS_BLOCKED');
      rebindingSpy.mockRestore();
    });

    it('enforces InternalServiceTargetPolicy for dedicated OT/factory networks', async () => {
      const internalPolicy = new InternalServiceTargetPolicy({
        allowedSubnets: ['192.168.10.0/24', '127.0.0.1', '10.0.0.0/8'],
        allowedPorts: [80, 443, 30040, 4000]
      });

      // Allowed factory machine subnet
      expect(internalPolicy.validateIp('192.168.10.50')).toBe(true);
      expect(internalPolicy.validatePort(30040)).toBe(true);

      // Pinned connection to Fuji machine controller
      const pinnedFuji = await SafeConnector.validateAndPin(
        'http://192.168.10.50:30040/nexim/status',
        internalPolicy
      );
      expect(pinnedFuji.pinnedIp).toBe('192.168.10.50');
      expect(pinnedFuji.port).toBe(30040);

      // Disallowed external IP
      expect(internalPolicy.validateIp('8.8.8.8')).toBe(false);
      await expect(
        SafeConnector.validateAndPin('http://8.8.8.8:30040/bad', internalPolicy)
      ).rejects.toThrow('SSRF_EGRESS_BLOCKED');

      // Disallowed port (e.g. port 22 SSH)
      expect(internalPolicy.validatePort(22)).toBe(false);
      await expect(
        SafeConnector.validateAndPin('http://192.168.10.50:22/ssh', internalPolicy)
      ).rejects.toThrow('SSRF_EGRESS_BLOCKED');
    });
  });

  describe('2. Transactional Onboarding & Provisioning State Machine', () => {
    beforeEach(async () => {
      await initDatabase();
      OnboardingService.reset();
    });

    it('rolls back completely to UNINITIALIZED if a provisioning step fails', async () => {
      expect(OnboardingService.getState()).toBe('UNINITIALIZED');
      const db = getDatabase();

      // Attempt 1: Validation failure (PIN < 12 characters)
      await expect(
        OnboardingService.provision({
          organizationId: 'org-fail-val',
          organizationName: 'Failing Org',
          siteId: 'site-fail-1',
          siteName: 'Site Fail 1',
          adminUsername: 'ADMIN_WEAK_PIN',
          adminPin: 'Short123!'
        })
      ).rejects.toThrow(/12 characters/i);

      expect(OnboardingService.getState()).toBe('UNINITIALIZED');

      // Ensure no rows were committed
      const orgRows1 = await db.query(
        "SELECT * FROM organization_settings WHERE organization_id = 'org-fail-val'"
      );
      expect(orgRows1.length).toBe(0);

      const opRows1 = await db.query(
        "SELECT * FROM operators WHERE code = 'ADMIN_WEAK_PIN'"
      );
      expect(opRows1.length).toBe(0);

      // Attempt 2: Mid-transaction failure (simulated error during secrets step)
      await expect(
        OnboardingService.provision(
          {
            organizationId: 'org-fail-step',
            organizationName: 'Failing Org Step',
            siteId: 'site-fail-2',
            siteName: 'Site Fail 2',
            adminUsername: 'ADMIN_MIDWAY_FAIL',
            adminPin: 'ValidLongEntropyPass2026!'
          },
          { simulateFailureStep: 'SECRETS' }
        )
      ).rejects.toThrow(/Simulated provisioning failure/);

      // Rollback invariant: Must revert to UNINITIALIZED
      expect(OnboardingService.getState()).toBe('UNINITIALIZED');

      // Verify that previously executed steps (Step 1 org and Step 2 operator) were atomically rolled back!
      const orgRows2 = await db.query(
        "SELECT * FROM organization_settings WHERE organization_id = 'org-fail-step'"
      );
      expect(orgRows2.length).toBe(0);

      const opRows2 = await db.query(
        "SELECT * FROM operators WHERE code = 'ADMIN_MIDWAY_FAIL'"
      );
      expect(opRows2.length).toBe(0);
    });

    it('once in PRODUCTION_ACTIVE, bootstrap/onboarding endpoint is disabled/unmounted permanently (returns 410 GONE)', async () => {
      const db = getDatabase();

      // Provision successfully to PRODUCTION_ACTIVE
      const provisionResult = await OnboardingService.provision({
        organizationId: 'org-prod-ready',
        organizationName: 'Apex Production Line A',
        siteId: 'site-noida-p4',
        siteName: 'Noida Phase 4 Plant',
        adminUsername: 'PROD_ADMIN_01',
        adminPin: 'EnterpriseSecurePassphrase2026!'
      });

      expect(provisionResult.status).toBe('PRODUCTION_ACTIVE');
      expect(OnboardingService.getState()).toBe('PRODUCTION_ACTIVE');

      // Verify DB reflects successful provisioning
      const orgRows = await db.query(
        "SELECT * FROM organization_settings WHERE organization_id = 'org-prod-ready'"
      );
      expect(orgRows.length).toBeGreaterThan(0);

      const adminRow = await db.query(
        "SELECT * FROM operators WHERE code = 'PROD_ADMIN_01'"
      );
      expect(adminRow.length).toBe(1);
      expect(adminRow[0].role).toBe('SYSTEM_ADMIN');

      // Bind dynamic HTTP server to test live route behavior
      const server = await new Promise<http.Server>((resolve) => {
        const s = app.listen(0, () => resolve(s));
      });
      const addr = server.address() as any;
      const baseUrl = `http://localhost:${addr.port}`;

      try {
        // Attempting POST /api/v1/auth/bootstrap once active returns 410 GONE
        const postRes = await fetch(`${baseUrl}/api/v1/auth/bootstrap`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            organizationId: 'org-backdoor',
            adminUsername: 'BACKDOOR_ATTACKER',
            adminPin: 'MaliciousPass123456!'
          })
        });

        expect(postRes.status).toBe(410);
        const postJson = await postRes.json();
        expect(postJson.error).toBe('ENDPOINT_GONE');

        // Attempting GET /api/v1/auth/bootstrap also returns 410 GONE
        const getRes = await fetch(`${baseUrl}/api/v1/auth/bootstrap`);
        expect(getRes.status).toBe(410);

        // Subsequent direct service calls also reject with 410
        await expect(
          OnboardingService.provision({
            adminUsername: 'BACKDOOR_DIRECT',
            adminPin: 'ValidLongPassphrase2026!'
          })
        ).rejects.toThrow(/APPLIANCE_ALREADY_PROVISIONED/);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });
  });

  describe('3. Edge Perimeter Hardening & Container Gateway Verification', () => {
    it('hardens docker-compose.yml by unpublishing Postgres host port and isolating Adminer behind debug profile', () => {
      const composePath = path.join(rootDir, 'docker-compose.yml');
      expect(fs.existsSync(composePath)).toBe(true);

      const content = fs.readFileSync(composePath, 'utf-8');

      // Adminer must be gated behind debug profile or excised
      expect(content).toContain('adminer:');
      expect(content).toMatch(/profiles:\s*\n\s*-\s*debug/);

      // Postgres 5432:5432 must NOT be published to host
      expect(content).not.toMatch(/^\s*-\s*["']?5432:5432["']?/m);

      // Caddy edge proxy service must be defined
      expect(content).toContain('caddy:');
      expect(content).toContain('image: caddy:2-alpine');
      expect(content).toContain('"80:80"');
      expect(content).toContain('"443:443"');
      expect(content).toContain('deploy/caddy/Caddyfile');
      expect(content).toContain('caddy_data:');
      expect(content).toContain('caddy_config:');
    });

    it('verifies Caddyfile configures TLS 1.2/1.3, HSTS, security headers, and reverse proxy routes', () => {
      const caddyfilePath = path.join(rootDir, 'deploy/caddy/Caddyfile');
      expect(fs.existsSync(caddyfilePath)).toBe(true);

      const content = fs.readFileSync(caddyfilePath, 'utf-8');

      // TLS 1.3 / 1.2 protocols
      expect(content).toMatch(/protocols\s+tls1.2\s+tls1.3/);

      // Security headers
      expect(content).toContain('Strict-Transport-Security');
      expect(content).toContain('max-age=31536000');
      expect(content).toContain('X-Content-Type-Options "nosniff"');
      expect(content).toContain('X-Frame-Options "DENY"');
      expect(content).toContain('Content-Security-Policy');

      // Metrics blocking
      expect(content).toContain('/metrics');
      expect(content).toContain('403');

      // Reverse proxy routing
      expect(content).toContain('reverse_proxy mes-api:4000');
      expect(content).toContain('reverse_proxy mes-web:80');
      expect(content).toContain('permanent');
    });
  });
});
