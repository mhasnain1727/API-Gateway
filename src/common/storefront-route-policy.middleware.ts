import { Request, Response, NextFunction } from 'express';
import { ConfigService } from '@nestjs/config';

function decodeJwtPayloadUnverified(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const json = Buffer.from(parts[1], 'base64url').toString('utf8');
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Paths allowed when the caller presents a Bearer JWT whose azp / client_id is listed in
 * ECOM_OAUTH_CLIENT_IDS. Admin and internal routes stay reachable from other OAuth clients.
 */
export function isStorefrontAllowedGatewayPath(fullPath: string, method: string): boolean {
  if (method === 'OPTIONS' || method === 'HEAD') return true;
  const p = fullPath.split('?')[0] || '';

  const starts = (prefix: string) => p === prefix || p.startsWith(`${prefix}/`);

  if (starts('/api/cus/auth')) return true;
  if (starts('/api/cus/me')) return true;
  if (starts('/api/cus/health')) return true;

  if (starts('/api/ord/me')) return true;
  if (starts('/api/ord/health')) return true;

  if (starts('/api/inv/public')) return true;
  if (starts('/api/inv/customer')) return true;
  if (starts('/api/inv/health')) return true;

  if (p === '/api/authz/token/refresh' || p === '/api/authz/oauth/token') return true;
  if (starts('/api/authz/health')) return true;

  if (starts('/api/iam/health')) return true;
  if (starts('/api/whms/health')) return true;
  if (starts('/api/gateway/health')) return true;

  return false;
}

/**
 * Express middleware: restrict configured storefront OAuth clients to storefront-only API paths.
 * When ECOM_OAUTH_CLIENT_IDS is unset or empty, this is a no-op.
 */
export function createStorefrontRoutePolicyMiddleware(configService: ConfigService) {
  const raw = configService.get<string>('ecom.oauthClientIds') ?? process.env.ECOM_OAUTH_CLIENT_IDS ?? '';
  const clientIds = new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );

  return (req: Request, res: Response, next: NextFunction) => {
    if (clientIds.size === 0) {
      return next();
    }

    const fullPath = (req.originalUrl || req.url || '').split('?')[0];
    if (!fullPath.startsWith('/api')) {
      return next();
    }

    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) {
      return next();
    }

    const token = auth.slice('Bearer '.length).trim();
    if (!token) {
      return next();
    }

    const payload = decodeJwtPayloadUnverified(token);
    const cid = String(payload?.azp ?? payload?.client_id ?? '').trim();
    if (!cid || !clientIds.has(cid)) {
      return next();
    }

    if (isStorefrontAllowedGatewayPath(fullPath, req.method || 'GET')) {
      return next();
    }

    return res.status(403).json({
      statusCode: 403,
      message:
        'This OAuth client is restricted to storefront routes (e.g. /api/inv/public, /api/inv/customer, /api/cus/auth, /api/cus/me, /api/ord/me).',
      error: 'Forbidden',
    });
  };
}
