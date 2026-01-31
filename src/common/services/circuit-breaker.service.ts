import { Injectable, Logger } from '@nestjs/common';

export enum CircuitState {
  CLOSED = 'CLOSED',     // Normal operation, requests pass through
  OPEN = 'OPEN',         // Failure threshold reached, requests blocked
  HALF_OPEN = 'HALF_OPEN' // Testing if service recovered
}

interface CircuitBreaker {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailure: number;
  nextAttempt: number;
}

interface CircuitBreakerConfig {
  failureThreshold: number;     // Number of failures before opening
  successThreshold: number;     // Successes needed in half-open to close
  timeout: number;              // Time in ms before attempting reset
}

@Injectable()
export class CircuitBreakerService {
  private readonly logger = new Logger(CircuitBreakerService.name);
  private readonly circuits = new Map<string, CircuitBreaker>();
  private readonly defaultConfig: CircuitBreakerConfig = {
    failureThreshold: 5,
    successThreshold: 3,
    timeout: 30000, // 30 seconds
  };

  /**
   * Check if request can proceed through the circuit
   */
  canRequest(serviceName: string): boolean {
    const circuit = this.getOrCreateCircuit(serviceName);

    switch (circuit.state) {
      case CircuitState.CLOSED:
        return true;

      case CircuitState.OPEN:
        if (Date.now() >= circuit.nextAttempt) {
          this.transitionTo(serviceName, CircuitState.HALF_OPEN);
          return true;
        }
        return false;

      case CircuitState.HALF_OPEN:
        return true;

      default:
        return true;
    }
  }

  /**
   * Record a successful request
   */
  recordSuccess(serviceName: string): void {
    const circuit = this.getOrCreateCircuit(serviceName);

    switch (circuit.state) {
      case CircuitState.HALF_OPEN:
        circuit.successes++;
        if (circuit.successes >= this.defaultConfig.successThreshold) {
          this.transitionTo(serviceName, CircuitState.CLOSED);
          this.logger.log(`Circuit CLOSED for ${serviceName} - Service recovered`);
        }
        break;

      case CircuitState.CLOSED:
        // Reset failure count on success
        circuit.failures = 0;
        break;
    }
  }

  /**
   * Record a failed request
   */
  recordFailure(serviceName: string, error?: Error): void {
    const circuit = this.getOrCreateCircuit(serviceName);
    circuit.failures++;
    circuit.lastFailure = Date.now();

    this.logger.warn(
      `Circuit failure recorded for ${serviceName}. Failures: ${circuit.failures}/${this.defaultConfig.failureThreshold}`,
    );

    switch (circuit.state) {
      case CircuitState.CLOSED:
        if (circuit.failures >= this.defaultConfig.failureThreshold) {
          this.transitionTo(serviceName, CircuitState.OPEN);
          this.logger.error(
            `Circuit OPENED for ${serviceName} - Failure threshold reached`,
          );
        }
        break;

      case CircuitState.HALF_OPEN:
        // Any failure in half-open goes back to open
        this.transitionTo(serviceName, CircuitState.OPEN);
        this.logger.warn(`Circuit re-OPENED for ${serviceName} - Failed during recovery test`);
        break;
    }
  }

  /**
   * Get current state of a circuit
   */
  getState(serviceName: string): CircuitState {
    return this.getOrCreateCircuit(serviceName).state;
  }

  /**
   * Get all circuit states
   */
  getAllStates(): Record<string, { state: CircuitState; failures: number }> {
    const states: Record<string, { state: CircuitState; failures: number }> = {};
    
    for (const [name, circuit] of this.circuits.entries()) {
      states[name] = {
        state: circuit.state,
        failures: circuit.failures,
      };
    }
    
    return states;
  }

  /**
   * Force reset a circuit to closed state
   */
  resetCircuit(serviceName: string): void {
    this.circuits.set(serviceName, this.createCircuit());
    this.logger.log(`Circuit manually reset for ${serviceName}`);
  }

  /**
   * Get time remaining until circuit can be tested (when open)
   */
  getTimeUntilRetry(serviceName: string): number {
    const circuit = this.circuits.get(serviceName);
    if (!circuit || circuit.state !== CircuitState.OPEN) {
      return 0;
    }
    return Math.max(0, circuit.nextAttempt - Date.now());
  }

  private getOrCreateCircuit(serviceName: string): CircuitBreaker {
    if (!this.circuits.has(serviceName)) {
      this.circuits.set(serviceName, this.createCircuit());
    }
    return this.circuits.get(serviceName)!;
  }

  private createCircuit(): CircuitBreaker {
    return {
      state: CircuitState.CLOSED,
      failures: 0,
      successes: 0,
      lastFailure: 0,
      nextAttempt: 0,
    };
  }

  private transitionTo(serviceName: string, newState: CircuitState): void {
    const circuit = this.getOrCreateCircuit(serviceName);
    circuit.state = newState;

    switch (newState) {
      case CircuitState.OPEN:
        circuit.nextAttempt = Date.now() + this.defaultConfig.timeout;
        break;

      case CircuitState.HALF_OPEN:
        circuit.successes = 0;
        break;

      case CircuitState.CLOSED:
        circuit.failures = 0;
        circuit.successes = 0;
        break;
    }
  }
}
