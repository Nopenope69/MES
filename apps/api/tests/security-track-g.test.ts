import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import net from 'net';
import { app } from '../src/server';
import { initDatabase, getDatabase } from '../src/db/database';
import { seedDatabase } from '../src/db/seed';
import { IpFirewall } from '../src/security/ip-firewall';
import { SimpleRateLimiter } from '../src/security/http-security';
import { SecretsConfigManager } from '../src/config/secrets';
import { FujiNeximAdapter } from '../src/adapters/fuji-nexim.adapter';
import { TokenManager } from '../src/security/jwt';
import { EdhrService } from '../src/services/edhr.service';
import express from 'express';

describe('Track G: Security Hardening & Secrets Hygiene Suite', () => {
  let server: http.Server;
  let baseUrl: string;
  let adminToken: string;

  beforeAll(async () => {
    await initDatabase();
    await seedDatabase();

    adminToken = TokenManager.generateAccessToken({
      sub: 'admin-01',
      code: 'SYS-ADMIN-01',
      name: 'Security Admin',
      role: 'SYSTEM_ADMIN',
      org: 'org-apex',
      site: 'site-noida-p4',
      authzVersion: 1
    });

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address();
        if (typeof addr === 'object' && addr !== null) {
          baseUrl = `http://localhost:${addr.port}`;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  describe('1. Industrial OT Subnet & IP Firewall Interlock', () => {
    it('accurately authorizes IP addresses against CIDR subnets and exact matches', () => {
      const allowedRules = ['192.168.10.0/24', '10.0.0.0/8', '127.0.0.1'];

      // Authorized addresses
      expect(IpFirewall.isAllowed('192.168.10.1', allowedRules)).toBe(true);
      expect(IpFirewall.isAllowed('192.168.10.254', allowedRules)).toBe(true);
      expect(IpFirewall.isAllowed('::ffff:192.168.10.45', allowedRules)).toBe(true);
      expect(IpFirewall.isAllowed('10.150.2.1', allowedRules)).toBe(true);
      expect(IpFirewall.isAllowed('127.0.0.1', allowedRules)).toBe(true);
      expect(IpFirewall.isAllowed('::1', allowedRules)).toBe(true);

      // Unauthorized external / untrusted corporate network addresses
      expect(IpFirewall.isAllowed('172.16.5.1', allowedRules)).toBe(false);
      expect(IpFirewall.isAllowed('192.168.20.1', allowedRules)).toBe(false);
      expect(IpFirewall.isAllowed('8.8.8.8', allowedRules)).toBe(false);
      expect(IpFirewall.isAllowed('', allowedRules)).toBe(false);
    });

    it('enforces OT firewall on Fuji TCP socket listener and rejects unauthorized IPs', async () => {
      const adapter = new FujiNeximAdapter();
      // Restrict listener strictly to a fake subnet (excluding 127.0.0.1 / localhost)
      adapter.setAllowedSubnets(['192.168.99.0/24']);

      const testPort = 39145;
      adapter.startListener(testPort);

      // Attempt TCP connection from localhost (which is not in 192.168.99.0/24)
      const socket = new net.Socket();
      let wasClosed = false;

      await new Promise<void>((resolve) => {
        socket.connect(testPort, '127.0.0.1', () => {
          // Connected, wait for server firewall to drop
        });

        socket.on('close', () => {
          wasClosed = true;
          resolve();
        });

        socket.on('error', () => {
          wasClosed = true;
          resolve();
        });

        setTimeout(resolve, 500);
      });

      expect(wasClosed).toBe(true);
      adapter.stopListener();
    });
  });

  describe('2. TCP Socket Buffer Flood & DoS Defense', () => {
    it('immediately terminates connections exceeding MAX_SOCKET_BUFFER limit', async () => {
      const adapter = new FujiNeximAdapter();
      adapter.setAllowedSubnets(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

      const testPort = 39146;
      adapter.startListener(testPort);
      await new Promise((r) => setTimeout(r, 50));

      const socket = new net.Socket();
      let socketTerminated = false;

      await new Promise<void>((resolve) => {
        socket.connect(testPort, '127.0.0.1', () => {
          // Send oversized payload (70KB >= 64KB MAX_SOCKET_BUFFER)
          const oversizedPayload = Buffer.alloc(70 * 1024, 0x41);
          socket.write(oversizedPayload);
        });

        socket.on('close', () => {
          socketTerminated = true;
          resolve();
        });

        socket.on('error', () => {
          socketTerminated = true;
          resolve();
        });

        setTimeout(resolve, 800);
      });

      expect(socketTerminated).toBe(true);
      adapter.stopListener();
    });
  });

  describe('3. HTTP Defense-in-Depth Security Headers', () => {
    it('returns OWASP recommended baseline security headers on HTTP responses', async () => {
      const res = await fetch(`${baseUrl}/health`);
      expect(res.status).toBe(200);

      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('x-frame-options')).toBe('DENY');
      expect(res.headers.get('strict-transport-security')).toContain('max-age=31536000');
      expect(res.headers.get('x-xss-protection')).toBe('1; mode=block');
      expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
      expect(res.headers.get('content-security-policy')).toContain("default-src 'self'");
    });
  });

  describe('4. Rate Limiting Defense', () => {
    it('returns HTTP 429 and Retry-After header when request threshold is exceeded', async () => {
      const testApp = express();
      const limiter = new SimpleRateLimiter(2000, 3); // 3 requests per 2 seconds
      testApp.use(limiter.middleware());
      testApp.get('/test-rate', (_req, res) => res.json({ ok: true }));

      const testServer = testApp.listen(0);
      const testAddr = testServer.address() as any;
      const testUrl = `http://localhost:${testAddr.port}/test-rate`;

      // Requests 1, 2, 3 should succeed
      const r1 = await fetch(testUrl);
      const r2 = await fetch(testUrl);
      const r3 = await fetch(testUrl);
      expect(r1.status).toBe(200);
      expect(r2.status).toBe(200);
      expect(r3.status).toBe(200);

      // Request 4 must be rate-limited
      const r4 = await fetch(testUrl);
      expect(r4.status).toBe(429);
      const r4Json = await r4.json();
      expect(r4Json.error).toBe('TOO_MANY_REQUESTS');
      expect(r4.headers.get('retry-after')).toBeDefined();

      await new Promise<void>((r) => testServer.close(() => r()));
    });
  });

  describe('5. Environment Hygiene & Secrets Vault Manager', () => {
    it('safely masks sensitive secrets for logging and audit trails', () => {
      expect(SecretsConfigManager.maskSecret('short')).toBe('****');
      expect(SecretsConfigManager.maskSecret('sk-1234567890abcdef123456')).toMatch(/^sk-1\.\.\.3456 \(\d+ chars\)$/);
      expect(SecretsConfigManager.maskSecret('')).toBe('[EMPTY]');
    });

    it('rejects weak/default secrets in production mode', () => {
      expect(() => {
        SecretsConfigManager.loadConfig({
          NODE_ENV: 'production',
          JWT_SECRET: 'short',
          API_KEY_SECRET: 'some-key'
        });
      }).toThrow(/Weak or default JWT_SECRET detected in production/);

      expect(() => {
        SecretsConfigManager.loadConfig({
          NODE_ENV: 'production',
          JWT_SECRET: 'a-super-long-jwt-key-with-password-in-it-123456',
          API_KEY_SECRET: 'valid-api-key-with-sufficient-entropy-987654321'
        });
      }).toThrow(/Weak or default JWT_SECRET detected in production/);
    });

    it('accepts compliant high-entropy secrets in production mode', () => {
      const config = SecretsConfigManager.loadConfig({
        NODE_ENV: 'production',
        PORT: '5000',
        JWT_SECRET: 'f9c8b7a6d5e4f3a2b1c09876543210fe_secure_jwt',
        API_KEY_SECRET: '9a8b7c6d5e4f3a2b1c0_mes_api_secure_key_2026'
      });

      expect(config.nodeEnv).toBe('production');
      expect(config.port).toBe(5000);
      expect(config.jwtSecret).toContain('secure_jwt');
    });

    it('exposes sanitized security audit report without leaking plain secrets', async () => {
      const res = await fetch(`${baseUrl}/api/v1/security/audit`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.environment).toBeDefined();
      expect(json.data.allowedSubnets).toBeInstanceOf(Array);
      expect(json.data.jwtSecretMasked).toContain('chars');
      expect(json.data.jwtSecretMasked).not.toBe(process.env.JWT_SECRET);
      expect(json.data.apiKeySecretMasked).toContain('chars');
    });
  });

  describe('6. Regulatory API Authentication Gate', () => {
    it('blocks unauthorized access to DHR release without valid API key and allows with valid key', async () => {
      // Ensure DHR exists and is in DRAFT state prior to testing release endpoint (prevents state leakage from previous test suites)
      const db = getDatabase();
      const existing = await db.query<any>("SELECT id FROM device_history_records WHERE dhr_number = 'DHR-JOB-SM-260901'");
      if (existing.length === 0) {
        await EdhrService.generateDhr('JOB-SM-260901', 'usr-sys-auto', 'SYSTEM_AUDITOR');
      }
      await db.execute(
        "UPDATE device_history_records SET status = 'DRAFT', qa_reviewer_id = NULL, qa_released_at = NULL WHERE dhr_number = 'DHR-JOB-SM-260901'"
      );

      const config = SecretsConfigManager.loadConfig();
      const qaApiKey = process.env.QA_SERVICE_KEY || `${config.apiKeySecret}-qa`;

      // 1. Missing API Key -> 401 Unauthorized
      const unauthorizedRes = await fetch(`${baseUrl}/api/v1/compliance/dhr/DHR-JOB-SM-260901/release`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qaMeaning: 'Attempt without key' })
      });
      expect(unauthorizedRes.status).toBe(401);
      const unauthJson = await unauthorizedRes.json();
      expect(unauthJson.error).toBe('UNAUTHORIZED');

      // 2. Invalid API Key -> 401 Unauthorized
      const invalidRes = await fetch(`${baseUrl}/api/v1/compliance/dhr/DHR-JOB-SM-260901/release`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'malicious-or-wrong-key'
        },
        body: JSON.stringify({ qaMeaning: 'Attempt with wrong key' })
      });
      expect(invalidRes.status).toBe(401);

      // 3. System Admin Master Key -> 403 Forbidden (Strict SoD: Admin cannot approve QA release)
      const adminRes = await fetch(`${baseUrl}/api/v1/compliance/dhr/DHR-JOB-SM-260901/release`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': config.apiKeySecret
        },
        body: JSON.stringify({
          qaMeaning: 'Attempt release with master admin key',
          releasedQuantity: 142
        })
      });
      expect(adminRes.status).toBe(403);

      // 4. Scoped QA Service Key -> 200 OK (Authorized Quality Approver)
      const validRes = await fetch(`${baseUrl}/api/v1/compliance/dhr/DHR-JOB-SM-260901/release`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': qaApiKey
        },
        body: JSON.stringify({
          qaMeaning: 'Approved with regulatory authentication gate',
          releasedQuantity: 142
        })
      });
      expect(validRes.status).toBe(200);
      const validJson = await validRes.json();
      expect(validJson.success).toBe(true);
      expect(validJson.data.status).toBe('RELEASED');
    });
  });
});
