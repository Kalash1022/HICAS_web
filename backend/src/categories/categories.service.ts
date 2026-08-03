import { HttpStatus, Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';

import { ApplicationException } from '../common/exceptions/application.exception';
import type { PaginatedResult } from '../common/interceptors/response-envelope.interceptor';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { CategoriesRepository } from './categories.repository';
import type { AdminCategory, CategoryMutationResult } from './categories.types';
import type { CreateCategoryDto } from './dto/create-category.dto';
import type { ListCategoriesQueryDto } from './dto/list-categories-query.dto';
import type { UpdateCategoryDto } from './dto/update-category.dto';

@Injectable()
export class CategoriesService {
  constructor(private readonly repository: CategoriesRepository) {}

  list(
    actor: AuthenticatedUser,
    query: ListCategoriesQueryDto,
  ): Promise<PaginatedResult<AdminCategory>> {
    this.assertCatalogManager(actor);
    return this.repository.list(query);
  }

  async create(actor: AuthenticatedUser, dto: CreateCategoryDto): Promise<AdminCategory> {
    this.assertCatalogManager(actor);
    return this.unwrapMutation(await this.repository.create(dto));
  }

  async update(
    actor: AuthenticatedUser,
    categoryId: string,
    dto: UpdateCategoryDto,
  ): Promise<AdminCategory> {
    this.assertCatalogManager(actor);
    return this.unwrapMutation(await this.repository.update(categoryId, dto));
  }

  async delete(actor: AuthenticatedUser, categoryId: string): Promise<{ deleted: true }> {
    this.assertCatalogManager(actor);
    const result = await this.repository.delete(categoryId);
    if (result.kind === 'not-found') {
      throw new ApplicationException(
        HttpStatus.NOT_FOUND,
        'CATEGORY_NOT_FOUND',
        'Category not found.',
      );
    }
    if (result.kind === 'not-empty') {
      throw new ApplicationException(
        HttpStatus.CONFLICT,
        'CATEGORY_NOT_EMPTY',
        'Categories that have products cannot be deleted.',
      );
    }
    return { deleted: true };
  }

  private unwrapMutation(result: CategoryMutationResult): AdminCategory {
    if (result.kind === 'updated') {
      return result.category;
    }
    if (result.kind === 'not-found') {
      throw new ApplicationException(
        HttpStatus.NOT_FOUND,
        'CATEGORY_NOT_FOUND',
        'Category not found.',
      );
    }
    this.throwDuplicateSlug();
  }

  private assertCatalogManager(actor: AuthenticatedUser): void {
    if (actor.role !== UserRole.STAFF && actor.role !== UserRole.ADMIN) {
      throw new ApplicationException(
        HttpStatus.FORBIDDEN,
        'AUTH_FORBIDDEN',
        'You do not have permission to manage the catalog.',
      );
    }
  }

  private throwDuplicateSlug(): never {
    throw new ApplicationException(
      HttpStatus.CONFLICT,
      'CATEGORY_SLUG_CONFLICT',
      'A category with this slug already exists.',
    );
  }
}
