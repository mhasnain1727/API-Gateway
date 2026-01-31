import { Module, Global } from '@nestjs/common';
import { CircuitBreakerService } from './services/circuit-breaker.service';
import { RequestDeduplicationService } from './services/request-deduplication.service';

@Global()
@Module({
  providers: [CircuitBreakerService, RequestDeduplicationService],
  exports: [CircuitBreakerService, RequestDeduplicationService],
})
export class CommonModule {}
