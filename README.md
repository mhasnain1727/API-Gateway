# ICS API Gateway Microservice

Centralized API Gateway for the ICS (Inventory Control System) microservices architecture.

## Features

### 1. **Centralized Entry Point**
- Single point of entry for all microservices
- Network policies enforcement
- Simplified client configuration

### 2. **Audit Logging (MongoDB)**
- All requests logged to MongoDB
- Request/response tracking with unique request IDs
- Sensitive data automatically redacted
- 90-day TTL with automatic cleanup
- Query and analytics support

### 3. **Rate Limiting**
- Global rate limiting for all endpoints
- Stricter limits for authentication endpoints (10 req/min vs 100 req/min)
- Per-client IP tracking
- Rate limit headers in responses

### 4. **Token Validation**
- JWT token presence check for protected routes
- Support for RS256 (recommended) and HS256 algorithms
- Automatic exclusion of public endpoints
- User info forwarded to downstream services

### 5. **Security Headers**
```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
Strict-Transport-Security: max-age=31536000; includeSubDomains (production only)
```

### 6. **Service Proxy**
- Routes requests to appropriate microservices
- CORS handling at gateway level
- Request ID propagation for tracing
- Service health monitoring

### 7. **Circuit Breaker Pattern**
- Protects against cascading failures
- Three states: CLOSED (normal), OPEN (blocking), HALF_OPEN (testing)
- Automatic recovery testing
- Manual reset capability via API
- Configurable thresholds (5 failures to open, 3 successes to close)

### 8. **Request Deduplication**
- Prevents duplicate request processing
- Supports `X-Idempotency-Key` header for mutation requests
- Automatically deduplicates identical GET requests
- 1-minute idempotency window for completed requests
- In-flight request coalescing

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        API Gateway (Port 3000)                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ Rate Limiter │  │ Token Check  │  │    Audit Logger      │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
│                              │                                   │
│  ┌───────────────────────────┴─────────────────────────────┐   │
│  │                      Proxy Router                         │   │
│  │  /api/iam/*   → IAM Service (3002)                       │   │
│  │  /api/authz/* → Auth Service (3001)                      │   │
│  │  /api/inv/*   → Inventory Service (3003)                 │   │
│  │  /api/cus/*   → Customer Service (3004)                  │   │
│  │  /api/whms/*  → Warehouse Service (3005)                 │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │     MongoDB     │
                    │  (Audit Logs)   │
                    └─────────────────┘
```

## Services

| Service | Port | Prefix | Description |
|---------|------|--------|-------------|
| IAM | 3002 | `/api/iam` | Identity & Access Management |
| Auth | 3001 | `/api/authz` | Authorization & Token Management |
| Inventory | 3003 | `/api/inv` | Product & Stock Management |
| Customer | 3004 | `/api/cus` | Customer Management |
| Warehouse | 3005 | `/api/whms` | Warehouse & Vendor Management |

## Public Endpoints (No Token Required)

### Authentication
- `POST /api/iam/auth/login`
- `POST /api/iam/auth/forgot-password`
- `POST /api/iam/auth/reset-password`
- `POST /api/iam/auth/validate-reset-token`
- `POST /api/cus/auth/signup`
- `POST /api/cus/auth/signin`
- `POST /api/authz/token/refresh`

### Health Checks
- `GET /api/gateway/health`
- `GET /api/iam/health`
- `GET /api/authz/health`
- `GET /api/inv/health`
- `GET /api/cus/health`
- `GET /api/whms/health`

### Vendor Portal (Token-based)
- `GET /api/whms/public/quotations/rfq/:token`
- `POST /api/whms/public/quotations/submit`
- `GET /api/whms/public/purchase-orders/:token`
- `POST /api/whms/public/purchase-orders/acknowledge`

## Storefront OAuth route policy (optional)

Set **`ECOM_OAUTH_CLIENT_IDS`** to a comma-separated list of OAuth2 **client_id** values (JWT **`azp`** or **`client_id`** claim) used by the ecom storefront. When this variable is set, requests that present a Bearer JWT from one of those clients may **only** reach the following prefixes; all other `/api/*` paths receive **403 Forbidden**.

| Allowed prefix | Purpose |
|----------------|---------|
| `/api/cus/auth/*` | Customer signup / signin / password reset |
| `/api/cus/me`, `/api/cus/me/*` | Authenticated customer profile |
| `/api/cus/health/*` | Health |
| `/api/ord/me/*` | Customer-scoped orders |
| `/api/ord/health/*` | Health |
| `/api/inv/public/*` | Guest catalog (DEFAULT pricing) |
| `/api/inv/customer/*` | Logged-in catalog (server-resolved pricing) |
| `/api/inv/health/*` | Health |
| `/api/authz/token/refresh`, `/api/authz/oauth/token` | Tokens |
| `/api/authz/health/*`, `/api/iam/health/*`, `/api/whms/health/*`, `/api/gateway/health/*` | Health |

Admin dashboards and staff tools should use a **different** OAuth client so they are not listed in `ECOM_OAUTH_CLIENT_IDS`. If the variable is **unset**, this check is disabled (backward compatible).

## Installation

```bash
# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Edit environment variables as needed
vim .env
```

## Configuration

### Environment Variables

```env
# Server
NODE_ENV=development
PORT=3000

# MongoDB (for Audit Logs)
MONGODB_URI=mongodb://localhost:27017/ics_gateway_audit

# JWT
JWT_PUBLIC_KEY_PATH=./keys/public.pem
JWT_ALGORITHM=RS256

# Service URLs
IAM_SERVICE_URL=http://localhost:3002
AUTHZ_SERVICE_URL=http://localhost:3001
INVENTORY_SERVICE_URL=http://localhost:3003
CUSTOMER_SERVICE_URL=http://localhost:3004
WAREHOUSE_SERVICE_URL=http://localhost:3005

# CORS
CORS_ORIGINS=http://localhost:4200,http://localhost:4201

# Rate Limiting
RATE_LIMIT_TTL=60000      # 1 minute window
RATE_LIMIT_MAX=100        # Max requests per window
RATE_LIMIT_AUTH_MAX=10    # Max auth requests per window

# Logging
LOG_LEVEL=info
ENABLE_AUDIT_LOG=true
```

### JWT Public Key Setup

For RS256 token validation, place your public key at `./keys/public.pem`:

```bash
mkdir -p keys
# Copy your public key
cp /path/to/your/public.pem keys/public.pem
```

## Running

```bash
# Development
npm run start:dev

# Production
npm run build
npm run start:prod
```

## API Documentation

Swagger UI available at: `http://localhost:3000/api/docs`

## Response Headers

All responses include:
- `X-Request-ID`: Unique request identifier for tracing
- `X-RateLimit-Limit`: Rate limit for the endpoint
- `X-RateLimit-Remaining`: Remaining requests in window
- `X-RateLimit-Reset`: Unix timestamp when limit resets

## Audit Log Schema

```javascript
{
  requestId: string,        // Unique request ID
  method: string,           // HTTP method
  path: string,             // Request path
  query: string,            // Query string
  headers: object,          // Request headers (sanitized)
  body: object,             // Request body (sanitized)
  userId: string,           // User ID (if authenticated)
  userEmail: string,        // User email (if available)
  userType: string,         // USER | CUSTOMER | SERVICE
  clientIp: string,         // Client IP address
  userAgent: string,        // User agent
  targetService: string,    // Target microservice
  statusCode: number,       // Response status
  responseTime: number,     // Response time (ms)
  rateLimited: boolean,     // Was request rate limited
  timestamp: Date,          // Request timestamp
  completedAt: Date         // Response timestamp
}
```

## Health Endpoints

### Gateway Health
```bash
curl http://localhost:3000/api/gateway/health
```

### All Services Health
```bash
curl http://localhost:3000/api/gateway/services/health
```

### Circuit Breaker Status
```bash
curl http://localhost:3000/api/gateway/circuits
```

### Reset Circuit Breaker
```bash
curl -X POST http://localhost:3000/api/gateway/circuits/iam-service/reset
```

### Deduplication Stats
```bash
curl http://localhost:3000/api/gateway/deduplication/stats
```

## Circuit Breaker States

| State | Description |
|-------|-------------|
| `CLOSED` | Normal operation, requests pass through |
| `OPEN` | Service failures exceeded threshold, requests blocked |
| `HALF_OPEN` | Testing if service recovered, limited requests allowed |

### Configuration
- **Failure Threshold**: 5 failures to open circuit
- **Success Threshold**: 3 successes in half-open to close
- **Timeout**: 30 seconds before attempting recovery

## Request Deduplication

### Using Idempotency Key
For POST/PUT/PATCH requests, include the `X-Idempotency-Key` header:

```bash
curl -X POST http://localhost:3000/api/inv/products \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -H "X-Idempotency-Key: unique-request-id-123" \
  -d '{"name": "Product"}'
```

If the same idempotency key is used within 1 minute, the original response is returned without re-processing.

## Error Responses

All errors follow a consistent format:

```json
{
  "statusCode": 401,
  "message": "Authorization header is missing",
  "error": "Unauthorized",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "path": "/api/iam/users",
  "requestId": "uuid-here"
}
```

## Development

```bash
# Run tests
npm test

# Run tests with coverage
npm run test:cov

# Lint
npm run lint

# Format
npm run format
```

## Production Considerations

1. **MongoDB**: Use a replica set for high availability
2. **Rate Limiting**: Consider Redis for distributed rate limiting
3. **JWT Keys**: Store keys in a secrets manager
4. **Logging**: Configure log aggregation (ELK, CloudWatch, etc.)
5. **Monitoring**: Add APM integration (DataDog, New Relic, etc.)
6. **SSL/TLS**: Always use HTTPS in production

## License

UNLICENSED - Proprietary
