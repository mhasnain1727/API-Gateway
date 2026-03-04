import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import * as bodyParser from 'body-parser';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { AppModule } from './app.module';
import { GlobalHttpExceptionFilter } from './common/filters';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'debug', 'verbose'],
  });

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT', 3000);
  const nodeEnv = configService.get<string>('NODE_ENV', 'development');

  // CORS: must run first so every response (including proxied) gets CORS headers
  const corsOriginsStr = configService.get<string>('cors.origins') ?? configService.get<string>('CORS_ORIGINS') ?? 'http://localhost:4200';
  const allowedOrigins = corsOriginsStr.split(',').map((o) => o.trim());
  const corsHeaders = {
    'Access-Control-Allow-Methods': 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept, Authorization, x-access-token, X-Idempotency-Key',
    'Access-Control-Allow-Credentials': 'true',
  };

  app.use((req: any, res: any, next: any) => {
    const origin = req.headers.origin;
    const allowOrigin = origin && (allowedOrigins.includes(origin) || allowedOrigins.includes('*'))
      ? origin
      : allowedOrigins[0] || 'http://localhost:4200';
    res.setHeader('Access-Control-Allow-Origin', allowOrigin);
    Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));

    // Preflight: respond immediately without proxying
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  // Security Headers with Helmet
  app.use(
    helmet({
      contentSecurityPolicy: nodeEnv === 'production' ? undefined : false,
      crossOriginEmbedderPolicy: false,
    }),
  );

  // Additional Security Headers
  app.use((req: any, res: any, next: any) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    if (nodeEnv === 'production') {
      res.setHeader(
        'Strict-Transport-Security',
        'max-age=31536000; includeSubDomains',
      );
    }
    next();
  });

  // Nest CORS (for non-proxy routes)
  app.enableCors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
        callback(null, origin || allowedOrigins[0]);
      } else {
        callback(null, allowedOrigins[0]);
      }
    },
    credentials: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: 'Origin, X-Requested-With, Content-Type, Accept, Authorization, x-access-token, X-Idempotency-Key',
  });

  // Body Parser (with increased limit for file uploads)
  app.use(bodyParser.json({ limit: '50mb' }));
  app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));

  // Proxy to microservices at Express level (so /api/iam, /api/authz etc. are handled before Nest router)
  const proxyTargets: { path: string; target: string; name: string }[] = [
    { path: '/api/iam', target: configService.get<string>('services.iam', 'http://localhost:3002'), name: 'IAM' },
    { path: '/api/authz', target: configService.get<string>('services.authz', 'http://localhost:3001'), name: 'Auth' },
    { path: '/api/inv', target: configService.get<string>('services.inventory', 'http://localhost:3003'), name: 'Inventory' },
    { path: '/api/cus', target: configService.get<string>('services.customer', 'http://localhost:3004'), name: 'Customer' },
    { path: '/api/whms', target: configService.get<string>('services.warehouse', 'http://localhost:3005'), name: 'Warehouse' },
  ];
  for (const { path: basePath, target, name } of proxyTargets) {
    app.use(
      basePath,
      createProxyMiddleware({
        target,
        changeOrigin: true,
        logLevel: 'silent',
        onProxyReq: (proxyReq, req: any) => {
          if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.body) {
            const ct = req.headers['content-type'] || '';
            if (ct.includes('application/json')) {
              const body = JSON.stringify(req.body);
              proxyReq.setHeader('Content-Length', Buffer.byteLength(body));
              proxyReq.write(body);
            }
          }
        },
        onProxyRes: (proxyRes, req: any) => {
          delete proxyRes.headers['access-control-allow-origin'];
          delete proxyRes.headers['access-control-allow-credentials'];
          const origin = req.headers.origin;
          const allowOrigin = origin && allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
          proxyRes.headers['access-control-allow-origin'] = allowOrigin;
          proxyRes.headers['access-control-allow-credentials'] = 'true';
        },
        onError: (err, req, res: any) => {
          logger.warn(`[${name}] Proxy error: ${err.message}`);
          if (!res.headersSent) {
            res.status(503).json({
              statusCode: 503,
              message: `${name} service is unavailable`,
              error: 'Service Unavailable',
              timestamp: new Date().toISOString(),
            });
          }
        },
      }),
    );
    logger.log(`Proxy: ${basePath} -> ${target}`);
  }

  // Global Exception Filter
  app.useGlobalFilters(new GlobalHttpExceptionFilter());

  // Validation Pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Swagger Documentation
  if (nodeEnv !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('ICS API Gateway')
      .setDescription(
        `
## ICS API Gateway Microservice

Centralized entry point for all ICS microservices.

### Features:
- **Rate Limiting**: Protects all services with configurable limits
- **Authentication**: Token presence validation for protected routes
- **Audit Logging**: All requests logged to MongoDB
- **Security Headers**: HSTS, X-Frame-Options, X-XSS-Protection
- **Proxy Routing**: Routes requests to appropriate microservices

### Services:
- **/api/iam/** - Identity & Access Management (port 3002)
- **/api/authz/** - Authorization Service (port 3001)
- **/api/inv/** - Inventory Service (port 3003)
- **/api/cus/** - Customer Service (port 3004)
- **/api/whms/** - Warehouse Management Service (port 3005)
        `,
      )
      .setVersion('1.0.0')
      .addBearerAuth()
      .addTag('Gateway', 'Gateway health and status endpoints')
      .addTag('Proxy', 'Proxied service endpoints')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  await app.listen(port);
  logger.log(`🚀 API Gateway is running on: http://localhost:${port}`);
  logger.log(`📚 Swagger docs: http://localhost:${port}/api/docs`);
  logger.log(`🔒 Environment: ${nodeEnv}`);
}

bootstrap();
