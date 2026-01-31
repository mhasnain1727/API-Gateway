import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { AuditLogService } from '../audit-log/audit-log.service';

// Extend Express Request to include custom properties
declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      startTime?: number;
      userId?: string;
      userEmail?: string;
      userType?: string;
    }
  }
}

@Injectable()
export class AuditLogMiddleware implements NestMiddleware {
  private readonly logger = new Logger(AuditLogMiddleware.name);

  constructor(private readonly auditLogService: AuditLogService) {}

  async use(req: Request, res: Response, next: NextFunction) {
    req.startTime = Date.now();

    // Determine target service from path
    const targetService = this.getTargetService(req.path);

    // Get client IP
    const clientIp = this.getClientIp(req);

    // Create audit log entry
    const requestId = await this.auditLogService.createLog({
      method: req.method,
      path: req.path,
      query: req.url.includes('?') ? req.url.split('?')[1] : undefined,
      headers: req.headers as Record<string, string>,
      body: req.body,
      clientIp,
      userAgent: req.headers['user-agent'],
      origin: req.headers.origin,
      targetService,
    });

    req.requestId = requestId;

    // Log request
    this.logger.log(
      `[${requestId}] ${req.method} ${req.path} - ${clientIp}`,
    );

    // Capture response
    const originalSend = res.send.bind(res);
    const startTime = req.startTime ?? Date.now();
    res.send = (body: any) => {
      const responseTime = Date.now() - startTime;

      // Update audit log with response
      this.auditLogService.updateLog(requestId, {
        statusCode: res.statusCode,
        responseTime,
        responseHeaders: res.getHeaders() as Record<string, string>,
        errorMessage: res.statusCode >= 400 ? this.extractErrorMessage(body) : undefined,
        completedAt: new Date(),
      });

      // Log response
      const logLevel = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'log';
      this.logger[logLevel](
        `[${requestId}] ${req.method} ${req.path} - ${res.statusCode} (${responseTime}ms)`,
      );

      return originalSend(body);
    };

    next();
  }

  private getTargetService(path: string): string {
    if (path.startsWith('/api/iam')) return 'iam-service';
    if (path.startsWith('/api/authz')) return 'authz-service';
    if (path.startsWith('/api/inv')) return 'inventory-service';
    if (path.startsWith('/api/cus')) return 'customer-service';
    if (path.startsWith('/api/whms')) return 'warehouse-service';
    if (path.startsWith('/api/gateway')) return 'gateway';
    return 'unknown';
  }

  private getClientIp(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
      const ips = Array.isArray(forwarded) ? forwarded[0] : forwarded;
      return ips.split(',')[0].trim();
    }
    return req.ip || req.socket.remoteAddress || 'unknown';
  }

  private extractErrorMessage(body: any): string | undefined {
    if (!body) return undefined;
    try {
      const parsed = typeof body === 'string' ? JSON.parse(body) : body;
      return parsed.message || parsed.error || undefined;
    } catch {
      return undefined;
    }
  }
}
