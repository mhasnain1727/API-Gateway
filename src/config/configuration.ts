export default () => ({
  // Server
  port: parseInt(process.env.PORT ?? '0', 10) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',

  // MongoDB
  mongodb: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/ics_gateway_audit',
  },

  // Service URLs
  services: {
    iam: process.env.IAM_SERVICE_URL || 'http://localhost:3002',
    authz: process.env.AUTHZ_SERVICE_URL || 'http://localhost:3001',
    inventory: process.env.INVENTORY_SERVICE_URL || 'http://localhost:3003',
    customer: process.env.CUSTOMER_SERVICE_URL || 'http://localhost:3004',
    warehouse: process.env.WAREHOUSE_SERVICE_URL || 'http://localhost:3005',
  },

  // CORS
  cors: {
    origins: process.env.CORS_ORIGINS || 'http://localhost:4200',
  },

  // Rate Limiting
  rateLimit: {
    ttl: parseInt(process.env.RATE_LIMIT_TTL ?? '0', 10) || 60000,
    max: parseInt(process.env.RATE_LIMIT_MAX ?? '0', 10) || 100,
    authMax: parseInt(process.env.RATE_LIMIT_AUTH_MAX ?? '0', 10) || 10,
  },

  // Logging
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    enableAudit: process.env.ENABLE_AUDIT_LOG === 'true',
  },

  // Public Routes (no token required)
  publicRoutes: [
    // Health checks
    '/api/gateway/health',
    '/api/iam/health',
    '/api/authz/health',
    '/api/inv/health',
    '/api/cus/health',
    '/api/whms/health',
    // Auth endpoints
    '/api/iam/auth/login',
    '/api/iam/auth/forgot-password',
    '/api/iam/auth/reset-password',
    '/api/iam/auth/validate-reset-token',
    '/api/cus/auth/signup',
    '/api/cus/auth/signin',
    '/api/cus/auth/forgot-password',
    '/api/cus/auth/reset-password',
    // Token endpoints
    '/api/authz/token/refresh',
    '/api/authz/oauth/token',
    // Swagger
    '/api/docs',
  ],

  // Public Route Patterns (regex patterns)
  publicRoutePatterns: [
    /^\/api\/whms\/public\/.*/,
    /^\/api\/cus\/health\/.*/,
    /^\/api\/docs\/.*/,
  ],
});
