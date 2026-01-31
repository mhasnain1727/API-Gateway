import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type AuditLogDocument = AuditLog & Document;

@Schema({
  collection: 'audit_logs',
  timestamps: true,
  versionKey: false,
})
export class AuditLog {
  @Prop({ type: Types.ObjectId, auto: true })
  _id: Types.ObjectId;

  // Request Information
  @Prop({ required: true, index: true })
  requestId: string;

  @Prop({ required: true, index: true })
  method: string;

  @Prop({ required: true, index: true })
  path: string;

  @Prop()
  query: string;

  @Prop({ type: Object })
  headers: Record<string, string>;

  @Prop({ type: Object })
  body: any;

  // User Information (if authenticated)
  @Prop({ index: true })
  userId?: string;

  @Prop()
  userEmail?: string;

  @Prop({ index: true })
  userType?: string; // 'USER' | 'CUSTOMER' | 'SERVICE'

  // Client Information
  @Prop({ index: true })
  clientIp: string;

  @Prop()
  userAgent: string;

  @Prop()
  origin?: string;

  // Target Service
  @Prop({ required: true, index: true })
  targetService: string;

  // Response Information
  @Prop({ index: true })
  statusCode?: number;

  @Prop()
  responseTime?: number; // in milliseconds

  @Prop({ type: Object })
  responseHeaders?: Record<string, string>;

  @Prop()
  errorMessage?: string;

  // Rate Limiting
  @Prop({ default: false })
  rateLimited: boolean;

  @Prop()
  rateLimitRemaining?: number;

  // Timestamps
  @Prop({ required: true, index: true })
  timestamp: Date;

  @Prop()
  completedAt?: Date;

  // Metadata
  @Prop({ type: Object })
  metadata?: Record<string, any>;
}

export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);

// Create indexes for common queries
AuditLogSchema.index({ timestamp: -1 });
AuditLogSchema.index({ userId: 1, timestamp: -1 });
AuditLogSchema.index({ targetService: 1, timestamp: -1 });
AuditLogSchema.index({ statusCode: 1, timestamp: -1 });
AuditLogSchema.index({ method: 1, path: 1, timestamp: -1 });
AuditLogSchema.index({ clientIp: 1, timestamp: -1 });

// TTL index to automatically delete old logs (90 days)
AuditLogSchema.index({ timestamp: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });
