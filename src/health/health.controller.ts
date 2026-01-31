import { Controller, Get, Post, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { HealthService, ServiceStatus } from './health.service';
import { CircuitBreakerService } from '../common/services/circuit-breaker.service';
import { RequestDeduplicationService } from '../common/services/request-deduplication.service';

@ApiTags('Gateway')
@Controller('api/gateway')
export class HealthController {
  constructor(
    private readonly healthService: HealthService,
    private readonly circuitBreaker: CircuitBreakerService,
    private readonly deduplication: RequestDeduplicationService,
  ) {}

  @Get('health')
  @ApiOperation({ summary: 'Gateway health check' })
  @ApiResponse({
    status: 200,
    description: 'Gateway is healthy',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'ok' },
        service: { type: 'string', example: 'ics-api-gateway' },
        timestamp: { type: 'string', example: '2024-01-01T00:00:00.000Z' },
        uptime: { type: 'number', example: 12345 },
        version: { type: 'string', example: '1.0.0' },
      },
    },
  })
  getHealth() {
    return this.healthService.getHealth();
  }

  @Get('health/live')
  @ApiOperation({ summary: 'Liveness probe' })
  @ApiResponse({ status: 200, description: 'Gateway is alive' })
  getLiveness() {
    return this.healthService.getLiveness();
  }

  @Get('health/ready')
  @ApiOperation({ summary: 'Readiness probe' })
  @ApiResponse({ status: 200, description: 'Gateway is ready' })
  @ApiResponse({ status: 503, description: 'Gateway is not ready' })
  async getReadiness() {
    return this.healthService.getReadiness();
  }

  @Get('services')
  @ApiOperation({ summary: 'Get configured services' })
  @ApiResponse({
    status: 200,
    description: 'List of configured services',
  })
  getServices() {
    return this.healthService.getServices();
  }

  @Get('services/health')
  @ApiOperation({ summary: 'Check health of all services' })
  @ApiResponse({
    status: 200,
    description: 'Health status of all services',
  })
  async getServicesHealth(): Promise<{
    status: string;
    services: ServiceStatus[];
    timestamp: string;
  }> {
    return this.healthService.checkServicesHealth();
  }

  @Get('circuits')
  @ApiOperation({ summary: 'Get circuit breaker states' })
  @ApiResponse({
    status: 200,
    description: 'Current state of all circuit breakers',
  })
  getCircuitStates() {
    return {
      circuits: this.circuitBreaker.getAllStates(),
      timestamp: new Date().toISOString(),
    };
  }

  @Post('circuits/:serviceName/reset')
  @ApiOperation({ summary: 'Reset a circuit breaker' })
  @ApiResponse({
    status: 200,
    description: 'Circuit breaker reset',
  })
  resetCircuit(@Param('serviceName') serviceName: string) {
    this.circuitBreaker.resetCircuit(serviceName);
    return {
      message: `Circuit breaker reset for ${serviceName}`,
      timestamp: new Date().toISOString(),
    };
  }

  @Get('deduplication/stats')
  @ApiOperation({ summary: 'Get request deduplication statistics' })
  @ApiResponse({
    status: 200,
    description: 'Deduplication statistics',
  })
  getDeduplicationStats() {
    return {
      stats: this.deduplication.getStats(),
      timestamp: new Date().toISOString(),
    };
  }
}
