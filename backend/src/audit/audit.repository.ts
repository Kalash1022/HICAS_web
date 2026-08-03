import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import type { PaginatedResult } from '../common/interceptors/response-envelope.interceptor';
import { DatabaseService } from '../database/database.service';
import type { ListAuditLogsQueryDto } from './dto/list-audit-logs-query.dto';
import type { AuditLogEntry } from './audit.types';

interface AuditLogRecord {
  id: string;
  actorId: string | null;
  action: AuditLogEntry['action'];
  entityType: string;
  entityId: string;
  beforeData: Prisma.JsonValue | null;
  afterData: Prisma.JsonValue | null;
  ipAddress: string | null;
  requestId: string | null;
  createdAt: Date;
  actor: { id: string; email: string; fullName: string } | null;
}

const SENSITIVE_AUDIT_FIELD =
  /(password|token|secret|otp|recovery[ _-]?code|verifier|authorization|cookie|credential)/i;

function sanitizeAuditJson(value: Prisma.JsonValue | null): Prisma.JsonValue | null {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeAuditJson(item));
  }

  const sanitized: Prisma.JsonObject = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    if (nestedValue === undefined) {
      continue;
    }
    sanitized[key] = SENSITIVE_AUDIT_FIELD.test(key)
      ? '[REDACTED]'
      : sanitizeAuditJson(nestedValue);
  }
  return sanitized;
}

@Injectable()
export class AuditRepository {
  constructor(private readonly database: DatabaseService) {}

  async list(input: ListAuditLogsQueryDto): Promise<PaginatedResult<AuditLogEntry>> {
    const entityType = input.entityType?.trim();
    const where: Prisma.AuditLogWhereInput = {
      ...(input.action === undefined ? {} : { action: input.action }),
      ...(input.actorId === undefined ? {} : { actorId: input.actorId }),
      ...(entityType ? { entityType } : {}),
      ...(input.entityId === undefined ? {} : { entityId: input.entityId }),
    };
    const [records, total] = await this.database.$transaction([
      this.database.auditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (input.page - 1) * input.limit,
        take: input.limit,
        select: {
          id: true,
          actorId: true,
          action: true,
          entityType: true,
          entityId: true,
          beforeData: true,
          afterData: true,
          ipAddress: true,
          requestId: true,
          createdAt: true,
          actor: {
            select: {
              id: true,
              email: true,
              fullName: true,
            },
          },
        },
      }),
      this.database.auditLog.count({ where }),
    ]);

    return {
      data: records.map((record) => this.toEntry(record)),
      pagination: {
        page: input.page,
        limit: input.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / input.limit)),
      },
    };
  }

  private toEntry(record: AuditLogRecord): AuditLogEntry {
    return {
      id: record.id,
      actorId: record.actorId,
      action: record.action,
      entityType: record.entityType,
      entityId: record.entityId,
      beforeData: sanitizeAuditJson(record.beforeData),
      afterData: sanitizeAuditJson(record.afterData),
      ipAddress: record.ipAddress,
      requestId: record.requestId,
      createdAt: record.createdAt,
      actor: record.actor,
    };
  }
}
