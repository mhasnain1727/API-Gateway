import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';

interface PendingRequest {
  promise: Promise<any>;
  timestamp: number;
  resolvers: Array<{
    resolve: (value: any) => void;
    reject: (reason: any) => void;
  }>;
}

interface CompletedRequest {
  response: any;
  timestamp: number;
  statusCode: number;
}

@Injectable()
export class RequestDeduplicationService {
  private readonly logger = new Logger(RequestDeduplicationService.name);
  
  // Store pending requests (in-flight)
  private readonly pendingRequests = new Map<string, PendingRequest>();
  
  // Store recently completed requests (for idempotency)
  private readonly completedRequests = new Map<string, CompletedRequest>();
  
  // Configuration
  private readonly idempotencyWindow = 60000; // 1 minute window for idempotency
  private readonly cleanupInterval = 30000;   // Clean up every 30 seconds

  constructor() {
    // Periodic cleanup of old entries
    setInterval(() => this.cleanup(), this.cleanupInterval);
  }

  /**
   * Generate a unique request key for deduplication
   */
  generateRequestKey(params: {
    method: string;
    path: string;
    body?: any;
    userId?: string;
    idempotencyKey?: string;
  }): string {
    // If an idempotency key is provided, use it directly
    if (params.idempotencyKey) {
      return `idempotency:${params.userId || 'anon'}:${params.idempotencyKey}`;
    }

    // For GET requests, use method + path + userId
    if (params.method === 'GET') {
      return `${params.method}:${params.path}:${params.userId || 'anon'}`;
    }

    // For mutation requests, include body hash
    const bodyHash = params.body
      ? crypto.createHash('md5').update(JSON.stringify(params.body)).digest('hex').substring(0, 8)
      : 'nobody';

    return `${params.method}:${params.path}:${params.userId || 'anon'}:${bodyHash}`;
  }

  /**
   * Check if a request is a duplicate and should be deduplicated
   * Returns the pending/completed response if duplicate, null otherwise
   */
  async checkDuplicate(requestKey: string): Promise<{ 
    isDuplicate: boolean; 
    response?: any;
    statusCode?: number;
    pending?: boolean;
  }> {
    // Check if there's a pending request with the same key
    const pending = this.pendingRequests.get(requestKey);
    if (pending) {
      this.logger.debug(`Found pending duplicate request: ${requestKey}`);
      
      // Wait for the original request to complete
      try {
        const response = await pending.promise;
        return { isDuplicate: true, response, pending: true };
      } catch (error) {
        // If original fails, let this request proceed
        return { isDuplicate: false };
      }
    }

    // Check if there's a recently completed request with the same key (for idempotency)
    const completed = this.completedRequests.get(requestKey);
    if (completed && Date.now() - completed.timestamp < this.idempotencyWindow) {
      this.logger.debug(`Found completed duplicate request: ${requestKey}`);
      return { 
        isDuplicate: true, 
        response: completed.response, 
        statusCode: completed.statusCode,
        pending: false 
      };
    }

    return { isDuplicate: false };
  }

  /**
   * Register a new request as pending
   * Returns a function to call when the request completes
   */
  registerRequest(requestKey: string): {
    onComplete: (response: any, statusCode: number) => void;
    onError: (error: any) => void;
  } {
    let resolvePromise: (value: any) => void;
    let rejectPromise: (reason: any) => void;

    const promise = new Promise<any>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });

    const pendingRequest: PendingRequest = {
      promise,
      timestamp: Date.now(),
      resolvers: [{ resolve: resolvePromise!, reject: rejectPromise! }],
    };

    this.pendingRequests.set(requestKey, pendingRequest);

    return {
      onComplete: (response: any, statusCode: number) => {
        // Store in completed requests for idempotency
        this.completedRequests.set(requestKey, {
          response,
          timestamp: Date.now(),
          statusCode,
        });

        // Resolve all waiting requests
        const pending = this.pendingRequests.get(requestKey);
        if (pending) {
          pending.resolvers.forEach(({ resolve }) => resolve(response));
          this.pendingRequests.delete(requestKey);
        }

        this.logger.debug(`Request completed: ${requestKey}`);
      },

      onError: (error: any) => {
        // Reject all waiting requests
        const pending = this.pendingRequests.get(requestKey);
        if (pending) {
          pending.resolvers.forEach(({ reject }) => reject(error));
          this.pendingRequests.delete(requestKey);
        }

        this.logger.debug(`Request failed: ${requestKey}`);
      },
    };
  }

  /**
   * Add a waiter to an existing pending request
   */
  async waitForPending(requestKey: string): Promise<any> {
    const pending = this.pendingRequests.get(requestKey);
    if (!pending) {
      throw new Error('No pending request found');
    }

    return new Promise((resolve, reject) => {
      pending.resolvers.push({ resolve, reject });
    });
  }

  /**
   * Get statistics about deduplication
   */
  getStats(): {
    pendingCount: number;
    completedCount: number;
    oldestPending: number | null;
    oldestCompleted: number | null;
  } {
    let oldestPending: number | null = null;
    let oldestCompleted: number | null = null;

    for (const pending of this.pendingRequests.values()) {
      if (oldestPending === null || pending.timestamp < oldestPending) {
        oldestPending = pending.timestamp;
      }
    }

    for (const completed of this.completedRequests.values()) {
      if (oldestCompleted === null || completed.timestamp < oldestCompleted) {
        oldestCompleted = completed.timestamp;
      }
    }

    return {
      pendingCount: this.pendingRequests.size,
      completedCount: this.completedRequests.size,
      oldestPending,
      oldestCompleted,
    };
  }

  /**
   * Clean up old completed requests
   */
  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;

    // Clean up old completed requests
    for (const [key, completed] of this.completedRequests.entries()) {
      if (now - completed.timestamp > this.idempotencyWindow) {
        this.completedRequests.delete(key);
        cleaned++;
      }
    }

    // Clean up stale pending requests (shouldn't happen, but safety check)
    for (const [key, pending] of this.pendingRequests.entries()) {
      if (now - pending.timestamp > 120000) { // 2 minutes max
        pending.resolvers.forEach(({ reject }) => 
          reject(new Error('Request timed out in deduplication queue'))
        );
        this.pendingRequests.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.debug(`Cleaned up ${cleaned} deduplication entries`);
    }
  }
}
