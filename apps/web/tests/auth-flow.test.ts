import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { authService, OperatorProfile } from '../src/services/auth.service';

describe('Web Cockpit: Operator Authentication & Session Client (Gate G-08)', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    authService.resetForTesting();
    // Ensure mock localStorage / sessionStorage if present in environment are wiped
    if (typeof window !== 'undefined') {
      window.localStorage?.clear();
      window.sessionStorage?.clear();
    }
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('1. In-Memory Token Storage & Web Storage Cleanliness (Gate G-08)', () => {
    it('stores access tokens strictly in volatile memory and NEVER in localStorage or sessionStorage', async () => {
      const mockOperator: OperatorProfile = {
        id: 'op-01',
        code: 'OP-01',
        name: 'Rajesh Sharma',
        role: 'OPERATOR',
        organizationId: 'org-dixon',
        siteId: 'site-noida-p4'
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          accessToken: 'jwt.in-memory.token.secret123',
          refreshToken: 'refresh.token.cookie',
          operator: mockOperator
        })
      });

      const res = await authService.login('OP-01', '1234');
      expect(res.success).toBe(true);
      expect(authService.isAuthenticated()).toBe(true);
      expect(authService.getAccessToken()).toBe('jwt.in-memory.token.secret123');

      // Verify zero leakage to Web Storage
      if (typeof window !== 'undefined') {
        expect(window.localStorage?.getItem('mes_token')).toBeNull();
        expect(window.localStorage?.getItem('mes_access_token')).toBeNull();
        expect(window.sessionStorage?.getItem('mes_token')).toBeNull();
        expect(window.sessionStorage?.getItem('mes_access_token')).toBeNull();
      }
    });
  });

  describe('2. Operator Login & Credential Verification', () => {
    it('authenticates valid operator and exposes current profile', async () => {
      const mockOperator: OperatorProfile = {
        id: 'qc-01',
        code: 'QC-LEAD-01',
        name: 'Ananya Iyer',
        role: 'QUALITY_LEAD'
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          accessToken: 'jwt.valid.token',
          operator: mockOperator
        })
      });

      const res = await authService.login('QC-LEAD-01', '4321');
      expect(res.success).toBe(true);
      expect(authService.getCurrentOperator()?.code).toBe('QC-LEAD-01');
      expect(authService.getCurrentOperator()?.role).toBe('QUALITY_LEAD');
    });

    it('rejects invalid PIN and leaves authentication state unauthenticated', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({
          success: false,
          error: 'INVALID_CREDENTIALS',
          locked: false
        })
      });

      const res = await authService.login('OP-01', 'wrong-pin');
      expect(res.success).toBe(false);
      expect(res.error).toBe('INVALID_CREDENTIALS');
      expect(authService.isAuthenticated()).toBe(false);
      expect(authService.getAccessToken()).toBeNull();
      expect(authService.getCurrentOperator()).toBeNull();
    });
  });

  describe('3. Reactive Auth State Subscriptions', () => {
    it('notifies subscribers synchronously upon login and logout', async () => {
      const stateLog: boolean[] = [];
      const unsubscribe = authService.subscribe((state) => {
        stateLog.push(state.isAuthenticated);
      });

      // Initial state: false
      expect(stateLog).toEqual([false]);

      // Seed session
      authService.setSessionForTesting('token-abc', {
        id: 'll-01',
        code: 'LL-01',
        name: 'Vikram Singh',
        role: 'LINE_LEAD'
      });

      expect(stateLog).toEqual([false, true]);

      // Log out
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true })
      });
      await authService.logout();

      expect(stateLog).toEqual([false, true, false]);

      unsubscribe();
    });
  });

  describe('4. Transparent Token Refresh on HTTP 401 (authFetch)', () => {
    it('retries original request with rotated token after 401 refresh', async () => {
      authService.setSessionForTesting('expired-access-token', {
        id: 'op-01',
        code: 'OP-01',
        name: 'Operator 1',
        role: 'OPERATOR'
      });

      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/api/v1/auth/refresh')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              accessToken: 'freshly-rotated-access-token'
            })
          };
        }

        callCount++;
        if (callCount === 1) {
          // First call fails with 401
          return {
            ok: false,
            status: 401,
            json: async () => ({ error: 'TOKEN_EXPIRED' })
          };
        }

        // Second call succeeds
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: 'secure-station-data' })
        };
      });

      const response = await authService.authFetch('/api/v1/mes/telemetry');
      expect(response.status).toBe(200);
      expect(authService.getAccessToken()).toBe('freshly-rotated-access-token');
      expect(callCount).toBe(2);
    });

    it('terminates session and logs out when refresh fails on 401', async () => {
      authService.setSessionForTesting('expired-access-token', {
        id: 'op-01',
        code: 'OP-01',
        name: 'Operator 1',
        role: 'OPERATOR'
      });

      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/api/v1/auth/refresh')) {
          return {
            ok: false,
            status: 401,
            json: async () => ({ success: false, error: 'SESSION_REVOKED' })
          };
        }
        return {
          ok: false,
          status: 401,
          json: async () => ({ error: 'UNAUTHORIZED' })
        };
      });

      const response = await authService.authFetch('/api/v1/mes/telemetry');
      expect(response.status).toBe(401);
      expect(authService.isAuthenticated()).toBe(false);
      expect(authService.getAccessToken()).toBeNull();
    });
  });

  describe('5. Role-Based Capabilities (Canonical 5 Roles)', () => {
    it('enforces role hierarchy and permissions checks', () => {
      // 1. Line Lead
      authService.setSessionForTesting('token-ll', {
        id: 'll-01',
        code: 'LL-01',
        name: 'Line Lead 1',
        role: 'LINE_LEAD'
      });

      expect(authService.hasRole('LINE_LEAD')).toBe(true);
      expect(authService.hasRole('OPERATOR', 'LINE_LEAD')).toBe(true);
      expect(authService.hasRole('QUALITY_LEAD')).toBe(false);

      // 2. System Admin (Superuser)
      authService.setSessionForTesting('token-admin', {
        id: 'admin-01',
        code: 'SYS-ADMIN-01',
        name: 'System Admin',
        role: 'SYSTEM_ADMIN'
      });

      // System Admin satisfies all role requirements
      expect(authService.hasRole('OPERATOR')).toBe(true);
      expect(authService.hasRole('QUALITY_LEAD')).toBe(true);
      expect(authService.hasRole('MAINTENANCE')).toBe(true);
      expect(authService.hasRole('LINE_LEAD')).toBe(true);
      expect(authService.hasRole('SYSTEM_ADMIN')).toBe(true);
    });
  });
});
