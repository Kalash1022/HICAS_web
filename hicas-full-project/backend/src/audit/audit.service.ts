import { HttpStatus, Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';

import { ApplicationException } from '../common/exceptions/application.exception';
import type { PaginatedResult } from '../common/interceptors/response-envelope.interceptor';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import type { ListAuditLogsQueryDto } from './dto/list-audit-logs-query.dto';
import { AuditRepository } from './audit.repository';
import type { AuditLogEntry } from './audit.types';

@Injectable()
export class AuditService {
  constructor(private readonly repository: AuditRepository) {}

  listAuditLogs(
    actor: AuthenticatedUser,
    query: ListAuditLogsQueryDto,
  ): Promise<PaginatedResult<AuditLogEntry>> {
    this.assertAdmin(actor);
    return this.repository.list(query);
  }

  private assertAdmin(actor: AuthenticatedUser): void {
    if (actor.role !== UserRole.ADMIN) {
      throw new ApplicationException(
        HttpStatus.FORBIDDEN,
        'AUTH_FORBIDDEN',
        'You do not have permission to view audit logs.',
      );
    }
  }
}
