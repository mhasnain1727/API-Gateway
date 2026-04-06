/**
 * CORS helpers for the API gateway. In non-production, any http(s) origin on
 * localhost / 127.0.0.1 is allowed so local dev works without editing CORS_ORIGINS
 * for every new frontend port.
 */
export function isLocalDevBrowserOrigin(origin: string): boolean {
  try {
    const u = new URL(origin);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return false;
    }
    const h = u.hostname.toLowerCase();
    return h === 'localhost' || h === '127.0.0.1' || h === '[::1]';
  } catch {
    return false;
  }
}

/** RFC1918 hosts — useful when the Next dev server is opened as http://192.168.x.x:3008 */
export function isPrivateLanDevOrigin(origin: string): boolean {
  try {
    const u = new URL(origin);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return false;
    }
    const h = u.hostname;
    if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
    if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
    const m = /^172\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(h);
    if (m) {
      const oct = Number(m[1]);
      return oct >= 16 && oct <= 31;
    }
    return false;
  } catch {
    return false;
  }
}

export function resolveCorsAllowOrigin(
  origin: string | undefined,
  allowedOrigins: string[],
  nodeEnv: string,
): string {
  const list = allowedOrigins.map((o) => o.trim()).filter(Boolean);
  const fallback = list[0] ?? 'http://localhost:3000';

  if (!origin) {
    return fallback;
  }

  if (list.includes('*')) {
    return origin;
  }
  if (list.includes(origin)) {
    return origin;
  }
  if (
    nodeEnv !== 'production' &&
    (isLocalDevBrowserOrigin(origin) || isPrivateLanDevOrigin(origin))
  ) {
    return origin;
  }
  return fallback;
}
