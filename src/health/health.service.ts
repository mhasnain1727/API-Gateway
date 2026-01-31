import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';

export interface ServiceStatus {
  name: string;
  url: string;
  status: 'healthy' | 'unhealthy' | 'unknown';
  responseTime?: number;
  error?: string;
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  private readonly startTime = Date.now();
  private readonly services: { name: string; url: string; healthPath: string }[];

  constructor(
    private readonly configService: ConfigService,
    @Optional() @InjectConnection() private readonly connection: Connection | null,
  ) {
    this.services = [
      {
        name: 'IAM Service',
        url: this.configService.get<string>('services.iam', 'http://localhost:3002'),
        healthPath: '/api/iam/health',
      },
      {
        name: 'Auth Service',
        url: this.configService.get<string>('services.authz', 'http://localhost:3001'),
        healthPath: '/api/authz/health',
      },
      {
        name: 'Inventory Service',
        url: this.configService.get<string>('services.inventory', 'http://localhost:3003'),
        healthPath: '/api/inv/health',
      },
      {
        name: 'Customer Service',
        url: this.configService.get<string>('services.customer', 'http://localhost:3004'),
        healthPath: '/api/cus/health',
      },
      {
        name: 'Warehouse Service',
        url: this.configService.get<string>('services.warehouse', 'http://localhost:3005'),
        healthPath: '/api/whms/health',
      },
    ];
  }

  getHealth() {
    return {
      status: 'ok',
      service: 'ics-api-gateway',
      timestamp: new Date().toISOString(),
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      version: '1.0.0',
      environment: this.configService.get<string>('NODE_ENV', 'development'),
    };
  }

  getLiveness() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  async getReadiness() {
    const mongoStatus = this.checkMongoConnection();
    // Gateway is ready even without MongoDB (audit logging disabled)
    const ready = mongoStatus === 'connected' || mongoStatus === 'disabled';

    return {
      status: ready ? 'ready' : 'not_ready',
      timestamp: new Date().toISOString(),
      checks: {
        mongodb: mongoStatus,
      },
    };
  }

  getServices() {
    return {
      services: this.services.map((s) => ({
        name: s.name,
        url: s.url,
        healthEndpoint: `${s.url}${s.healthPath}`,
      })),
      timestamp: new Date().toISOString(),
    };
  }

  async checkServicesHealth(): Promise<{
    status: string;
    services: ServiceStatus[];
    timestamp: string;
  }> {
    const results: ServiceStatus[] = [];

    for (const service of this.services) {
      const status = await this.checkServiceHealth(service);
      results.push(status);
    }

    const allHealthy = results.every((s) => s.status === 'healthy');
    const anyHealthy = results.some((s) => s.status === 'healthy');

    return {
      status: allHealthy ? 'healthy' : anyHealthy ? 'degraded' : 'unhealthy',
      services: results,
      timestamp: new Date().toISOString(),
    };
  }

  private async checkServiceHealth(service: {
    name: string;
    url: string;
    healthPath: string;
  }): Promise<ServiceStatus> {
    const startTime = Date.now();

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${service.url}${service.healthPath}`, {
        signal: controller.signal,
      });

      clearTimeout(timeout);

      return {
        name: service.name,
        url: service.url,
        status: response.ok ? 'healthy' : 'unhealthy',
        responseTime: Date.now() - startTime,
      };
    } catch (error) {
      return {
        name: service.name,
        url: service.url,
        status: 'unhealthy',
        responseTime: Date.now() - startTime,
        error: error.message,
      };
    }
  }

  private checkMongoConnection(): string {
    if (!this.connection) {
      return 'disabled';
    }
    const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
    return states[this.connection.readyState] || 'unknown';
  }
}
