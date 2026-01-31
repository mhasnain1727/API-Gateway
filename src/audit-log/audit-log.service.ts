import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AuditLog, AuditLogDocument } from './schemas/audit-log.schema';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';

export interface CreateAuditLogDto {
  method: string;
  path: string;
  query?: string;
  headers?: Record<string, string>;
  body?: any;
  userId?: string;
  userEmail?: string;
  userType?: string;
  clientIp: string;
  userAgent?: string;
  origin?: string;
  targetService: string;
  metadata?: Record<string, any>;
}

export interface UpdateAuditLogDto {
  statusCode?: number;
  responseTime?: number;
  responseHeaders?: Record<string, string>;
  errorMessage?: string;
  rateLimited?: boolean;
  rateLimitRemaining?: number;
  completedAt?: Date;
}

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);
  private readonly enableAudit: boolean;

  constructor(
    @InjectModel(AuditLog.name)
    private readonly auditLogModel: Model<AuditLogDocument>,
    private readonly configService: ConfigService,
  ) {
    this.enableAudit = this.configService.get<boolean>('logging.enableAudit', true);
  }

  /**
   * Create a new audit log entry when request starts
   */
  async createLog(dto: CreateAuditLogDto): Promise<string> {
    if (!this.enableAudit) {
      return uuidv4();
    }

    try {
      const requestId = uuidv4();
      const sanitizedBody = this.sanitizeBody(dto.body);
      const sanitizedHeaders = this.sanitizeHeaders(dto.headers || {});

      const auditLog = new this.auditLogModel({
        requestId,
        method: dto.method,
        path: dto.path,
        query: dto.query,
        headers: sanitizedHeaders,
        body: sanitizedBody,
        userId: dto.userId,
        userEmail: dto.userEmail,
        userType: dto.userType,
        clientIp: dto.clientIp,
        userAgent: dto.userAgent,
        origin: dto.origin,
        targetService: dto.targetService,
        timestamp: new Date(),
        metadata: dto.metadata,
      });

      await auditLog.save();
      return requestId;
    } catch (error) {
      this.logger.error(`Failed to create audit log: ${error.message}`);
      return uuidv4();
    }
  }

  /**
   * Update audit log with response information
   */
  async updateLog(requestId: string, dto: UpdateAuditLogDto): Promise<void> {
    if (!this.enableAudit) {
      return;
    }

    try {
      await this.auditLogModel.updateOne(
        { requestId },
        {
          $set: {
            statusCode: dto.statusCode,
            responseTime: dto.responseTime,
            responseHeaders: dto.responseHeaders,
            errorMessage: dto.errorMessage,
            rateLimited: dto.rateLimited || false,
            rateLimitRemaining: dto.rateLimitRemaining,
            completedAt: dto.completedAt || new Date(),
          },
        },
      );
    } catch (error) {
      this.logger.error(`Failed to update audit log ${requestId}: ${error.message}`);
    }
  }

  /**
   * Query audit logs with filters
   */
  async findLogs(filters: {
    userId?: string;
    targetService?: string;
    method?: string;
    path?: string;
    statusCode?: number;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
    skip?: number;
  }): Promise<AuditLogDocument[]> {
    const query: any = {};

    if (filters.userId) query.userId = filters.userId;
    if (filters.targetService) query.targetService = filters.targetService;
    if (filters.method) query.method = filters.method;
    if (filters.path) query.path = { $regex: filters.path, $options: 'i' };
    if (filters.statusCode) query.statusCode = filters.statusCode;
    if (filters.startDate || filters.endDate) {
      query.timestamp = {};
      if (filters.startDate) query.timestamp.$gte = filters.startDate;
      if (filters.endDate) query.timestamp.$lte = filters.endDate;
    }

    return this.auditLogModel
      .find(query)
      .sort({ timestamp: -1 })
      .limit(filters.limit || 100)
      .skip(filters.skip || 0)
      .exec();
  }

  /**
   * Get audit log statistics
   */
  async getStats(startDate: Date, endDate: Date): Promise<any> {
    const stats = await this.auditLogModel.aggregate([
      {
        $match: {
          timestamp: { $gte: startDate, $lte: endDate },
        },
      },
      {
        $group: {
          _id: {
            targetService: '$targetService',
            method: '$method',
            statusCode: { $cond: [{ $gte: ['$statusCode', 400] }, 'error', 'success'] },
          },
          count: { $sum: 1 },
          avgResponseTime: { $avg: '$responseTime' },
        },
      },
    ]);

    return stats;
  }

  /**
   * Sanitize request body to remove sensitive data
   */
  private sanitizeBody(body: any): any {
    if (!body) return null;

    const sensitiveFields = [
      'password',
      'confirmPassword',
      'currentPassword',
      'newPassword',
      'token',
      'refreshToken',
      'accessToken',
      'apiKey',
      'secret',
      'creditCard',
      'cardNumber',
      'cvv',
      'ssn',
    ];

    const sanitized = { ...body };

    const sanitizeObject = (obj: any) => {
      if (typeof obj !== 'object' || obj === null) return obj;

      for (const key of Object.keys(obj)) {
        if (sensitiveFields.some((field) => key.toLowerCase().includes(field.toLowerCase()))) {
          obj[key] = '[REDACTED]';
        } else if (typeof obj[key] === 'object') {
          sanitizeObject(obj[key]);
        }
      }
      return obj;
    };

    return sanitizeObject(sanitized);
  }

  /**
   * Sanitize headers to remove sensitive data
   */
  private sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
    const sensitiveHeaders = ['authorization', 'x-api-key', 'cookie', 'x-internal-api-key'];
    const sanitized: Record<string, string> = {};

    for (const [key, value] of Object.entries(headers)) {
      if (sensitiveHeaders.includes(key.toLowerCase())) {
        sanitized[key] = '[REDACTED]';
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }
}
