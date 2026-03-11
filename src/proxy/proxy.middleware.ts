import { Injectable, NestMiddleware, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { ConfigService } from '@nestjs/config';
import { createProxyMiddleware, Options } from 'http-proxy-middleware';
import { CircuitBreakerService, CircuitState } from '../common/services/circuit-breaker.service';
import { RequestDeduplicationService } from '../common/services/request-deduplication.service';

interface ServiceConfig {
  prefix: string;
  target: string;
  name: string;
  key: string;
}

@Injectable()
export class ProxyMiddleware implements NestMiddleware {
  private readonly logger = new Logger(ProxyMiddleware.name);
  private readonly services: ServiceConfig[];
  private readonly corsOrigins: string[];
  private readonly proxies: Map<string, ReturnType<typeof createProxyMiddleware>>;

  constructor(
    private readonly configService: ConfigService,
    private readonly circuitBreaker: CircuitBreakerService,
    private readonly deduplication: RequestDeduplicationService,
  ) {
    this.services = [
      {
        prefix: '/api/iam',
        target: this.configService.get<string>('services.iam', 'http://localhost:3002'),
        name: 'IAM Service',
        key: 'iam-service',
      },
      {
        prefix: '/api/authz',
        target: this.configService.get<string>('services.authz', 'http://localhost:3001'),
        name: 'Auth Service',
        key: 'authz-service',
      },
      {
        prefix: '/api/inv',
        target: this.configService.get<string>('services.inventory', 'http://localhost:3003'),
        name: 'Inventory Service',
        key: 'inventory-service',
      },
      {
        prefix: '/api/cus',
        target: this.configService.get<string>('services.customer', 'http://localhost:3004'),
        name: 'Customer Service',
        key: 'customer-service',
      },
      {
        prefix: '/api/whms',
        target: this.configService.get<string>('services.warehouse', 'http://localhost:3005'),
        name: 'Warehouse Service',
        key: 'warehouse-service',
      },
      {
        prefix: '/api/ord',
        target: this.configService.get<string>('services.order', 'http://localhost:3006'),
        name: 'Order Service',
        key: 'order-service',
      },
    ];

    this.corsOrigins = this.configService
      .get<string>('cors.origins', 'http://localhost:4200')
      .split(',')
      .map((o) => o.trim());

    this.proxies = new Map();
    this.initializeProxies();
  }

  private initializeProxies(): void {
    for (const service of this.services) {
      const proxy = this.createProxy(service);
      this.proxies.set(service.prefix, proxy);
      this.logger.log(`Proxy configured: ${service.prefix} -> ${service.target}`);
    }
  }

  private createProxy(service: ServiceConfig): ReturnType<typeof createProxyMiddleware> {
    const options: Options = {
      target: service.target,
      changeOrigin: true,
      ws: true,
      logLevel: 'silent',

      // Handle proxy errors
      onError: (err, req, res) => {
        this.logger.error(`[${service.name}] Proxy error: ${err.message}`);
        
        // Record failure in circuit breaker
        this.circuitBreaker.recordFailure(service.key, err as Error);

        if (!res.headersSent) {
          const retryAfter = Math.ceil(this.circuitBreaker.getTimeUntilRetry(service.key) / 1000);
          
          (res as Response).status(503).json({
            statusCode: 503,
            message: `${service.name} is unavailable`,
            error: 'Service Unavailable',
            timestamp: new Date().toISOString(),
            retryAfter: retryAfter > 0 ? retryAfter : undefined,
          });
        }
      },

      // Modify proxy request
      onProxyReq: (proxyReq, req) => {
        // Forward request ID for tracing
        if ((req as any).requestId) {
          proxyReq.setHeader('X-Request-ID', (req as any).requestId);
        }

        // Forward user info if available
        if ((req as any).userId) {
          proxyReq.setHeader('X-User-ID', (req as any).userId);
        }
        if ((req as any).userType) {
          proxyReq.setHeader('X-User-Type', (req as any).userType);
        }

        // Handle body for POST/PUT/PATCH
        if (['POST', 'PUT', 'PATCH'].includes(req.method || '') && (req as any).body) {
          const contentType = req.headers['content-type'] || '';

          // Only re-stream JSON body (multipart should pass through)
          if (contentType.includes('application/json')) {
            const bodyData = JSON.stringify((req as any).body);
            proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
            proxyReq.write(bodyData);
          }
        }

        this.logger.debug(
          `[${service.name}] Proxying: ${req.method} ${req.url}`,
        );
      },

      // Modify proxy response
      onProxyRes: (proxyRes, req, res) => {
        // Record success/failure in circuit breaker based on status
        if (proxyRes.statusCode && proxyRes.statusCode >= 500) {
          this.circuitBreaker.recordFailure(service.key);
        } else {
          this.circuitBreaker.recordSuccess(service.key);
        }

        // Remove upstream CORS headers
        delete proxyRes.headers['access-control-allow-origin'];
        delete proxyRes.headers['access-control-allow-credentials'];
        delete proxyRes.headers['access-control-allow-methods'];
        delete proxyRes.headers['access-control-allow-headers'];

        // Add gateway CORS headers
        const origin = req.headers.origin;
        const allowOrigin = origin && this.corsOrigins.includes(origin)
          ? origin
          : this.corsOrigins[0];

        res.setHeader('Access-Control-Allow-Origin', allowOrigin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS');
        res.setHeader(
          'Access-Control-Allow-Headers',
          'Origin, X-Requested-With, Content-Type, Accept, Authorization, x-access-token, X-Idempotency-Key',
        );

        // Add request ID to response
        if ((req as any).requestId) {
          res.setHeader('X-Request-ID', (req as any).requestId);
        }

        // Add circuit breaker state header
        res.setHeader('X-Circuit-State', this.circuitBreaker.getState(service.key));

        this.logger.debug(
          `[${service.name}] Response: ${proxyRes.statusCode} for ${req.method} ${req.url}`,
        );
      },
    };

    return createProxyMiddleware(options);
  }

  async use(req: Request, res: Response, next: NextFunction) {
    // Find matching service (path may have or omit leading slash)
    const path = req.path.startsWith('/') ? req.path : `/${req.path}`;
    const service = this.services.find((s) => path.startsWith(s.prefix));

    if (!service) {
      return next();
    }

    // Check circuit breaker
    if (!this.circuitBreaker.canRequest(service.key)) {
      const retryAfter = Math.ceil(this.circuitBreaker.getTimeUntilRetry(service.key) / 1000);
      
      this.logger.warn(`Circuit OPEN for ${service.name} - Request blocked`);
      
      res.setHeader('Retry-After', retryAfter);
      res.setHeader('X-Circuit-State', CircuitState.OPEN);
      
      throw new HttpException(
        {
          statusCode: HttpStatus.SERVICE_UNAVAILABLE,
          message: `${service.name} is temporarily unavailable. Please retry after ${retryAfter} seconds.`,
          error: 'Service Unavailable',
          retryAfter,
          circuitState: CircuitState.OPEN,
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    // Check for request deduplication (for mutation requests with idempotency key)
    const idempotencyKey = req.headers['x-idempotency-key'] as string;
    
    // Only deduplicate POST/PUT/PATCH with idempotency key or GET requests
    if (idempotencyKey || req.method === 'GET') {
      const requestKey = this.deduplication.generateRequestKey({
        method: req.method,
        path: req.path,
        body: ['POST', 'PUT', 'PATCH'].includes(req.method) ? req.body : undefined,
        userId: (req as any).userId,
        idempotencyKey,
      });

      const duplicate = await this.deduplication.checkDuplicate(requestKey);
      
      if (duplicate.isDuplicate) {
        this.logger.debug(`Deduplicated request: ${requestKey}`);
        
        res.setHeader('X-Deduplicated', 'true');
        res.setHeader('X-Request-ID', (req as any).requestId || 'deduplicated');
        
        return res.status(duplicate.statusCode || 200).json(duplicate.response);
      }

      // Register this request for deduplication
      if (idempotencyKey) {
        const { onComplete, onError } = this.deduplication.registerRequest(requestKey);
        
        // Store callbacks for later
        (req as any).deduplicationCallbacks = { onComplete, onError };
      }
    }

    const proxy = this.proxies.get(service.prefix);
    if (proxy) {
      return proxy(req, res, next);
    }

    next();
  }
}
