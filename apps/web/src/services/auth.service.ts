/**
 * Operator Authentication & Session Client (Gate G-08)
 *
 * Enforces:
 * 1. In-memory only access token storage (NEVER written to localStorage or sessionStorage)
 * 2. Automatic refresh token rotation via HttpOnly __Host-mes-refresh cookie on 401
 * 3. Reactive auth state subscriptions for UI components
 * 4. Role-based capability checks across the canonical 5 SMT roles
 */

export type OperatorRole = 
  | 'OPERATOR' 
  | 'MAINTENANCE' 
  | 'QUALITY_LEAD' 
  | 'LINE_LEAD' 
  | 'SYSTEM_ADMIN';

export interface OperatorProfile {
  id: string;
  code: string;
  name: string;
  role: OperatorRole;
  organizationId?: string;
  siteId?: string;
}

export interface AuthState {
  isAuthenticated: boolean;
  operator: OperatorProfile | null;
  expiresAt: number | null;
}

type AuthSubscriber = (state: AuthState) => void;

class AuthServiceSingleton {
  // STRICT INVARIANT: Tokens live in volatile memory only. Never written to Web Storage.
  private accessToken: string | null = null;
  private currentOperator: OperatorProfile | null = null;
  private expiresAt: number | null = null;
  private subscribers: Set<AuthSubscriber> = new Set();
  private isRefreshing = false;
  private refreshQueue: Array<(token: string | null) => void> = [];

  constructor() {
    // Proactively verify localStorage and sessionStorage are never polluted
    this.assertStorageClean();
  }

  private assertStorageClean(): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem('mes_token');
        window.localStorage.removeItem('mes_access_token');
        window.localStorage.removeItem('mes_refresh_token');
      }
      if (typeof window !== 'undefined' && window.sessionStorage) {
        window.sessionStorage.removeItem('mes_token');
        window.sessionStorage.removeItem('mes_access_token');
      }
    } catch {
      // Ignored in non-browser/mock test environments
    }
  }

  public getAuthState(): AuthState {
    return {
      isAuthenticated: !!this.accessToken && !!this.currentOperator,
      operator: this.currentOperator,
      expiresAt: this.expiresAt
    };
  }

  public isAuthenticated(): boolean {
    return !!this.accessToken && !!this.currentOperator;
  }

  public getAccessToken(): string | null {
    return this.accessToken;
  }

  public getCurrentOperator(): OperatorProfile | null {
    return this.currentOperator;
  }

  public hasRole(...requiredRoles: OperatorRole[]): boolean {
    if (!this.currentOperator) return false;
    if (this.currentOperator.role === 'SYSTEM_ADMIN') return true;
    return requiredRoles.includes(this.currentOperator.role);
  }

  public subscribe(subscriber: AuthSubscriber): () => void {
    this.subscribers.add(subscriber);
    // Immediately emit current state
    subscriber(this.getAuthState());
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  private notify(): void {
    const state = this.getAuthState();
    for (const subscriber of this.subscribers) {
      try {
        subscriber(state);
      } catch (err) {
        console.error('[AuthService] Error in subscriber callback:', err);
      }
    }
  }

  /**
   * Authenticates operator with Badge Code and PIN.
   */
  public async login(
    code: string, 
    pin: string
  ): Promise<{ success: boolean; error?: string; operator?: OperatorProfile }> {
    try {
      const response = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include', // Ensures HttpOnly cookie is captured
        body: JSON.stringify({ code: code.trim(), pin: pin.trim() })
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        return {
          success: false,
          error: data.error || `Authentication failed (HTTP ${response.status})`
        };
      }

      this.accessToken = data.accessToken;
      this.currentOperator = data.operator;
      // Access tokens are valid for 15 minutes (900 seconds)
      this.expiresAt = Date.now() + 15 * 60 * 1000;

      this.assertStorageClean();
      this.notify();

      return {
        success: true,
        operator: this.currentOperator!
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.message || 'Network error during operator login'
      };
    }
  }

  /**
   * Rotates session and acquires a fresh in-memory access token using HttpOnly cookie.
   */
  public async refresh(): Promise<boolean> {
    if (this.isRefreshing) {
      // If refresh already in progress, wait for outcome
      return new Promise<boolean>((resolve) => {
        this.refreshQueue.push((token) => resolve(!!token));
      });
    }

    this.isRefreshing = true;

    try {
      const response = await fetch('/api/v1/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include'
      });

      const data = await response.json();

      if (response.ok && data.success && data.accessToken) {
        this.accessToken = data.accessToken;
        this.expiresAt = Date.now() + 15 * 60 * 1000;
        this.notify();

        this.refreshQueue.forEach((cb) => cb(this.accessToken));
        this.refreshQueue = [];
        return true;
      } else {
        // Refresh token invalid or revoked -> clear local state
        this.clearSession();
        this.refreshQueue.forEach((cb) => cb(null));
        this.refreshQueue = [];
        return false;
      }
    } catch {
      this.clearSession();
      this.refreshQueue.forEach((cb) => cb(null));
      this.refreshQueue = [];
      return false;
    } finally {
      this.isRefreshing = false;
    }
  }

  /**
   * Logs out current operator, revoking server-side session and clearing memory state.
   */
  public async logout(): Promise<void> {
    try {
      await fetch('/api/v1/auth/logout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {})
        },
        credentials: 'include'
      });
    } catch {
      // Ignored - client cleanup proceeds regardless
    } finally {
      this.clearSession();
    }
  }

  private clearSession(): void {
    this.accessToken = null;
    this.currentOperator = null;
    this.expiresAt = null;
    this.assertStorageClean();
    this.notify();
  }

  /**
   * Authenticated HTTP Fetch wrapper.
   * Injects Bearer token and retries once on 401 with transparent token refresh.
   */
  public async authFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const originalHeaders = new Headers(init?.headers || {});
    
    if (this.accessToken && !originalHeaders.has('Authorization')) {
      originalHeaders.set('Authorization', `Bearer ${this.accessToken}`);
    }

    const modifiedInit: RequestInit = {
      ...init,
      headers: originalHeaders,
      credentials: 'include'
    };

    let response = await fetch(input, modifiedInit);

    // If 401 Unauthorized encountered, attempt single token refresh
    if (response.status === 401) {
      const refreshed = await this.refresh();
      if (refreshed && this.accessToken) {
        const retryHeaders = new Headers(init?.headers || {});
        retryHeaders.set('Authorization', `Bearer ${this.accessToken}`);
        response = await fetch(input, {
          ...init,
          headers: retryHeaders,
          credentials: 'include'
        });
      } else {
        // Refresh failed -> session permanently terminated
        this.clearSession();
      }
    }

    return response;
  }

  /**
   * Test harness helper to reset state between unit tests.
   */
  public resetForTesting(): void {
    this.accessToken = null;
    this.currentOperator = null;
    this.expiresAt = null;
    this.subscribers.clear();
    this.refreshQueue = [];
    this.isRefreshing = false;
    this.assertStorageClean();
  }

  /**
   * In-memory test helper to seed an active authenticated session without network calls.
   */
  public setSessionForTesting(token: string, operator: OperatorProfile): void {
    this.accessToken = token;
    this.currentOperator = operator;
    this.expiresAt = Date.now() + 15 * 60 * 1000;
    this.assertStorageClean();
    this.notify();
  }
}

export const authService = new AuthServiceSingleton();
