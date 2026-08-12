import type { AuditAction, Prisma } from '@prisma/client';

export interface AuditActor {
  id: string;
  email: string;
  fullName: string;
}

export interface AuditLogEntry {
  id: string;
  actorId: string | null;
  action: AuditAction;
  entityType: string;
  entityId: string;
  beforeData: Prisma.JsonValue | null;
  afterData: Prisma.JsonValue | null;
  ipAddress: string | null;
  requestId: string | null;
  createdAt: Date;
  actor: AuditActor | null;
}
