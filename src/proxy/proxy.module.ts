import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ProxyMiddleware } from './proxy.middleware';

@Module({
  imports: [ConfigModule],
  providers: [ProxyMiddleware],
})
export class ProxyModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Apply proxy to all routes; middleware only proxies when path matches /api/iam, /api/authz, etc.
    consumer.apply(ProxyMiddleware).forRoutes('*');
  }
}
