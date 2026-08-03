import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import type { Request } from 'express';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { getOrCreateRequestId } from '../common/middleware/request-id';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import type { PaginatedResult } from '../common/interceptors/response-envelope.interceptor';
import { requestContextFromRequest } from '../auth/utilities/request-context';
import { AdministrationService } from './administration.service';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { UpdateUserRoleDto } from './dto/update-user-role.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import type { AdminUserDetail, AdminUserSummary } from './administration.types';

@ApiTags('Administration - Users')
@ApiBearerAuth('access-token')
@Roles(UserRole.ADMIN)
@Controller('admin/users')
export class AdministrationController {
  constructor(private readonly administration: AdministrationService) {}

  @Get()
  @ApiOperation({ summary: 'List users for administration' })
  list(
    @Query() query: ListUsersQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<PaginatedResult<AdminUserSummary>> {
    return this.administration.listUsers(actor, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an administrative user detail' })
  get(
    @Param('id', new ParseUUIDPipe({ version: '4' })) userId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<AdminUserDetail> {
    return this.administration.getUser(actor, userId);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Block or unblock a user' })
  @ApiResponse({ status: HttpStatus.OK })
  updateStatus(
    @Param('id', new ParseUUIDPipe({ version: '4' })) userId: string,
    @Body() dto: UpdateUserStatusDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<AdminUserDetail> {
    return this.administration.updateStatus({
      actor,
      targetUserId: userId,
      requestedStatus: dto.status,
      request: requestContextFromRequest(request),
      requestId: getOrCreateRequestId(request),
    });
  }

  @Patch(':id/role')
  @ApiOperation({ summary: 'Change a user role and revoke active sessions' })
  updateRole(
    @Param('id', new ParseUUIDPipe({ version: '4' })) userId: string,
    @Body() dto: UpdateUserRoleDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<AdminUserDetail> {
    return this.administration.updateRole({
      actor,
      targetUserId: userId,
      requestedRole: dto.role,
      request: requestContextFromRequest(request),
      requestId: getOrCreateRequestId(request),
    });
  }

  @Post(':id/mfa/reset')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset MFA for another Staff or Administrator' })
  resetMfa(
    @Param('id', new ParseUUIDPipe({ version: '4' })) userId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<AdminUserDetail> {
    return this.administration.resetMfa({
      actor,
      targetUserId: userId,
      request: requestContextFromRequest(request),
      requestId: getOrCreateRequestId(request),
    });
  }
}
