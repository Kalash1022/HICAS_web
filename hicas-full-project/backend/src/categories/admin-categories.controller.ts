import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { PaginatedResult } from '../common/interceptors/response-envelope.interceptor';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { CategoriesService } from './categories.service';
import type { AdminCategory } from './categories.types';
import { CreateCategoryDto } from './dto/create-category.dto';
import { ListCategoriesQueryDto } from './dto/list-categories-query.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@ApiTags('Administration - Categories')
@ApiBearerAuth('access-token')
@Roles(UserRole.STAFF, UserRole.ADMIN)
@Controller('admin/categories')
export class AdminCategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @ApiOperation({ summary: 'List categories for catalog administration' })
  list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListCategoriesQueryDto,
  ): Promise<PaginatedResult<AdminCategory>> {
    return this.categories.list(actor, query);
  }

  @Post()
  @ApiOperation({ summary: 'Create a category' })
  @ApiResponse({ status: HttpStatus.CREATED })
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateCategoryDto,
  ): Promise<AdminCategory> {
    return this.categories.create(actor, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a category' })
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) categoryId: string,
    @Body() dto: UpdateCategoryDto,
  ): Promise<AdminCategory> {
    return this.categories.update(actor, categoryId, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a category that has never had products' })
  delete(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) categoryId: string,
  ): Promise<{ deleted: true }> {
    return this.categories.delete(actor, categoryId);
  }
}
