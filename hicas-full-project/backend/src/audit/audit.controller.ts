import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { PaginatedResult } from '../common/interceptors/response-envelope.interceptor';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { AuditService } from './audit.service';
import { ListAuditLogsQueryDto } from './dto/list-audit-logs-query.dto';
import type { AuditLogEntry } from './audit.types';

@ApiTags('Administration - Audit logs')
@ApiBearerAuth('access-token')
@Roles(UserRole.ADMIN)
@Controller('admin/audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @ApiOperation({ summary: 'List audit logs for administration' })
  list(
    @Query() query: ListAuditLogsQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<PaginatedResult<AuditLogEntry>> {
    return this.audit.listAuditLogs(actor, query);
  }
}
