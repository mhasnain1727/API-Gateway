import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule, getConnectionToken } from '@nestjs/mongoose';
import { ThrottlerModule } from '@nestjs/throttler';

// Modules
import { AuditLogModule } from './audit-log/audit-log.module';
import { AuditLogService } from './audit-log/audit-log.service';
import { CommonModule } from './common/common.module';
import { ProxyModule } from './proxy/proxy.module';
import { HealthModule } from './health/health.module';

// Middleware
import { AuditLogMiddleware } from './middleware/audit-log.middleware';
import { TokenValidationMiddleware } from './middleware/token-validation.middleware';
import { RateLimitMiddleware } from './middleware/rate-limit.middleware';

// Configuration
import configuration from './config/configuration';

const useMongo = !!(process.env.MONGODB_URI && process.env.MONGODB_URI.trim() !== '');

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: ['.env', '.env.local'],
    }),

    // MongoDB for Audit Logs (optional – gateway starts without it if MONGODB_URI not set)
    ...(useMongo
      ? [
          MongooseModule.forRootAsync({
            imports: [ConfigModule],
            useFactory: async (configService: ConfigService) => ({
              uri: configService.get<string>('MONGODB_URI') || configService.get<string>('mongodb.uri'),
              dbName: 'ics_gateway_audit',
              serverSelectionTimeoutMS: 5000,
              connectTimeoutMS: 5000,
            }),
            inject: [ConfigService],
          }),
        ]
      : []),

    // Rate Limiting (Global)
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          ttl: config.get<number>('rateLimit.ttl', 60000),
          limit: config.get<number>('rateLimit.max', 100),
        },
      ],
    }),

    // Feature Modules
    CommonModule,
    ...(useMongo ? [AuditLogModule] : []),
    ProxyModule,
    HealthModule,
  ],
  providers: useMongo
    ? []
    : [
        { provide: getConnectionToken(), useValue: null },
        { provide: AuditLogService, useValue: null },
      ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Apply audit logging only when MongoDB is configured
    if (useMongo) {
      consumer.apply(AuditLogMiddleware).forRoutes('*');
    }

    // Apply stricter rate limiting to auth endpoints
    consumer
      .apply(RateLimitMiddleware)
      .forRoutes(
        'api/iam/auth/*',
        'api/cus/auth/*',
        'api/authz/token/*',
      );

    // Apply token validation to protected routes (exclude public endpoints)
    consumer
      .apply(TokenValidationMiddleware)
      .exclude(
        // Health endpoints
        'api/gateway/health',
        'api/iam/health',
        'api/authz/health',
        'api/inv/health',
        'api/cus/health',
        'api/cus/health/(.*)',
        'api/whms/health',
        'api/ord/health',
        // Auth endpoints
        'api/iam/auth/login',
        'api/iam/auth/forgot-password',
        'api/iam/auth/reset-password',
        'api/iam/auth/validate-reset-token',
        'api/cus/auth/signup',
        'api/cus/auth/signin',
        'api/cus/auth/forgot-password',
        'api/cus/auth/reset-password',
        // Token refresh
        'api/authz/token/refresh',
        'api/authz/oauth/token',
        // Public vendor endpoints
        'api/whms/public/(.*)',
        // Swagger docs
        'api/docs',
        'api/docs/(.*)',
      )
      .forRoutes('api/*');
  }
}
