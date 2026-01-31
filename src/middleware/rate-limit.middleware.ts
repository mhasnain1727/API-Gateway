import { Injectable, NestMiddleware, HttpException, HttpStatus, Logger, Optional } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { ConfigService } from '@nestjs/config';
import { AuditLogService } from '../audit-log/audit-log.service';

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

@Injectable()
export class RateLimitMiddleware implements NestMiddleware {
  private readonly logger = new Logger(RateLimitMiddleware.name);
  private readonly store = new Map<string, RateLimitEntry>();
  private readonly ttl: number;
  private readonly maxRequests: number;
  private readonly authMaxRequests: number;

  constructor(
    private readonly configService: ConfigService,
    @Optional() private readonly auditLogService: AuditLogService | null,
  ) {
    this.ttl = this.configService.get<number>('rateLimit.ttl', 60000);
    this.maxRequests = this.configService.get<number>('rateLimit.max', 100);
    this.authMaxRequests = this.configService.get<number>('rateLimit.authMax', 10);

    // Cleanup expired entries every minute
    setInterval(() => this.cleanup(), 60000);
  }

  async use(req: Request, res: Response, next: NextFunction) {
    const clientKey = this.getClientKey(req);
    const isAuthEndpoint = this.isAuthEndpoint(req.path);
    const limit = isAuthEndpoint ? this.authMaxRequests : this.maxRequests;

    const now = Date.now();
    let entry = this.store.get(clientKey);

    // Initialize or reset entry
    if (!entry || now > entry.resetTime) {
      entry = {
        count: 0,
        resetTime: now + this.ttl,
      };
    }

    entry.count++;
    this.store.set(clientKey, entry);

    const remaining = Math.max(0, limit - entry.count);
    const resetInSeconds = Math.ceil((entry.resetTime - now) / 1000);

    // Set rate limit headers
    res.setHeader('X-RateLimit-Limit', limit);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', Math.ceil(entry.resetTime / 1000));

    if (entry.count > limit) {
      this.logger.warn(
        `Rate limit exceeded for ${clientKey} on ${req.path}. Count: ${entry.count}, Limit: ${limit}`,
      );

      // Update audit log with rate limit info (when audit logging is enabled)
      if (req.requestId && this.auditLogService) {
        await this.auditLogService.updateLog(req.requestId, {
          rateLimited: true,
          rateLimitRemaining: 0,
          statusCode: 429,
        });
      }

      res.setHeader('Retry-After', resetInSeconds);
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: `Too many requests. Please try again in ${resetInSeconds} seconds.`,
          error: 'Too Many Requests',
          retryAfter: resetInSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Update audit log with rate limit info (when audit logging is enabled)
    if (req.requestId && this.auditLogService) {
      await this.auditLogService.updateLog(req.requestId, {
        rateLimited: false,
        rateLimitRemaining: remaining,
      });
    }

    next();
  }

  private getClientKey(req: Request): string {
    // Use IP + path prefix for more granular rate limiting
    const ip = this.getClientIp(req);
    const pathPrefix = req.path.split('/').slice(0, 4).join('/');
    return `${ip}:${pathPrefix}`;
  }

  private getClientIp(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
      const ips = Array.isArray(forwarded) ? forwarded[0] : forwarded;
      return ips.split(',')[0].trim();
    }
    return req.ip || req.socket.remoteAddress || 'unknown';
  }

  private isAuthEndpoint(path: string): boolean {
    const authPatterns = [
      '/api/iam/auth/',
      '/api/cus/auth/',
      '/api/authz/token/',
    ];
    return authPatterns.some((pattern) => path.startsWith(pattern));
  }

  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.store.entries()) {
      if (now > entry.resetTime) {
        this.store.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.debug(`Cleaned up ${cleaned} expired rate limit entries`);
    }
  }
}
