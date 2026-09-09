import { Router, Request, Response } from 'express';
import { AuthenticationService } from '../services/authentication.service';
import { SessionManager } from '../security/session-manager';
import { TrustedProxyResolver } from '../security/trusted-proxy';
import { OnboardingService } from '../services/onboarding.service';

export const authRouter = Router();

function parseCookies(cookieHeader?: string): Record<string, string> {
  if (!cookieHeader) return {};
  const cookies: Record<string, string> = {};
  cookieHeader.split(';').forEach((pair) => {
    const [name, ...rest] = pair.trim().split('=');
    if (name) {
      cookies[name] = decodeURIComponent(rest.join('='));
    }
  });
  return cookies;
}

/**
 * POST /api/v1/auth/login
 * Authenticates operator using code and PIN.
 * Returns short-lived access JWT and rotating refresh token, setting HttpOnly __Host-mes-refresh cookie.
 */
authRouter.post('/login', async (req: Request, res: Response) => {
  try {
    const { code, pin } = req.body || {};
    if (!code || !pin) {
      return res.status(400).json({
        success: false,
        error: 'code and pin are required'
      });
    }

    const ipAddress = TrustedProxyResolver.extractClientIp(req);
    const result = await AuthenticationService.loginWithPin(code, pin, ipAddress);

    if (!result.success) {
      return res.status(401).json({
        success: false,
        error: result.error,
        locked: result.locked
      });
    }

    if (result.refreshToken) {
      res.cookie('__Host-mes-refresh', result.refreshToken, {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: '/',
        maxAge: 12 * 60 * 60 * 1000 // 12 hours
      });
    }

    res.json({
      success: true,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      operator: result.operator
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/v1/auth/refresh
 * Rotates session family and issues fresh 15-minute access JWT.
 */
authRouter.post('/refresh', async (req: Request, res: Response) => {
  try {
    const cookies = (req as any).cookies || parseCookies(req.headers.cookie);
    const refreshToken = req.body?.refreshToken || cookies['__Host-mes-refresh'] || cookies['mes-refresh'];

    if (!refreshToken) {
      return res.status(401).json({
        success: false,
        error: 'REFRESH_TOKEN_REQUIRED'
      });
    }

    const ipAddress = TrustedProxyResolver.extractClientIp(req);
    const result = await AuthenticationService.refreshSession(refreshToken, ipAddress);

    if (!result.success) {
      return res.status(401).json({
        success: false,
        error: result.error
      });
    }

    if (result.refreshToken) {
      res.cookie('__Host-mes-refresh', result.refreshToken, {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: '/',
        maxAge: 12 * 60 * 60 * 1000
      });
    }

    res.json({
      success: true,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/v1/auth/logout
 * Explicit logout revoking entire session family and clearing cookie.
 */
authRouter.post('/logout', async (req: Request, res: Response) => {
  try {
    const cookies = (req as any).cookies || parseCookies(req.headers.cookie);
    const refreshToken = req.body?.refreshToken || cookies['__Host-mes-refresh'] || cookies['mes-refresh'];

    if (refreshToken) {
      const record = await SessionManager.lookupToken(refreshToken);
      if (record) {
        await SessionManager.revokeFamily(record.familyId, 'USER_LOGOUT');
      }
    }

    res.clearCookie('__Host-mes-refresh', {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/'
    });

    res.json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * /api/v1/auth/bootstrap
 * One-time transactional onboarding & appliance provisioning endpoint.
 * When in PRODUCTION_ACTIVE, permanently rejects all requests with HTTP 410 GONE.
 */
authRouter.all('/bootstrap', async (req: Request, res: Response) => {
  if (OnboardingService.getState() === 'PRODUCTION_ACTIVE') {
    return res.status(410).json({
      success: false,
      error: 'ENDPOINT_GONE',
      message: 'Appliance is in PRODUCTION_ACTIVE state. Bootstrap endpoint is permanently unmounted.'
    });
  }

  if (req.method === 'GET') {
    return res.json({
      success: true,
      state: OnboardingService.getState(),
      message: 'Appliance is ready for initial provisioning'
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: 'METHOD_NOT_ALLOWED',
      message: 'Only POST is supported for provisioning'
    });
  }

  try {
    const result = await OnboardingService.provision(req.body);
    return res.status(201).json({
      success: true,
      message: 'Appliance successfully provisioned to PRODUCTION_ACTIVE.',
      data: result
    });
  } catch (err: any) {
    const statusCode = err.statusCode || 400;
    return res.status(statusCode).json({
      success: false,
      error: err.message || 'Provisioning failed'
    });
  }
});

