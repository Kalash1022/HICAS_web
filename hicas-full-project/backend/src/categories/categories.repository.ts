import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { DatabaseService } from '../database/database.service';
import type { PaginatedResult } from '../common/interceptors/response-envelope.interceptor';
import type { CreateCategoryDto } from './dto/create-category.dto';
import type { ListCategoriesQueryDto } from './dto/list-categories-query.dto';
import type { UpdateCategoryDto } from './dto/update-category.dto';
import type {
  AdminCategory,
  CategoryDeleteResult,
  CategoryMutationResult,
} from './categories.types';
import type { PublicCategory } from './public-categories.types';

function isKnownRequestError(error: unknown, code: string): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}

@Injectable()
export class CategoriesRepository {
  constructor(private readonly database: DatabaseService) {}

  async list(input: ListCategoriesQueryDto): Promise<PaginatedResult<AdminCategory>> {
    const search = input.search?.trim();
    const where: Prisma.CategoryWhereInput = {
      ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { slug: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [data, total] = await this.database.$transaction([
      this.database.category.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (input.page - 1) * input.limit,
        take: input.limit,
      }),
      this.database.category.count({ where }),
    ]);

    return {
      data,
      pagination: {
        page: input.page,
        limit: input.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / input.limit)),
      },
    };
  }

  listPublic(): Promise<PublicCategory[]> {
    return this.database.category.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        sortOrder: true,
      },
    });
  }

  async create(input: CreateCategoryDto): Promise<CategoryMutationResult> {
    try {
      const category = await this.database.category.create({
        data: {
          name: input.name,
          slug: input.slug,
          description: input.description,
          sortOrder: input.sortOrder ?? 0,
          isActive: input.isActive ?? true,
        },
      });
      return { kind: 'updated', category };
    } catch (error) {
      if (isKnownRequestError(error, 'P2002')) {
        return { kind: 'duplicate-slug' };
      }
      throw error;
    }
  }

  async update(categoryId: string, input: UpdateCategoryDto): Promise<CategoryMutationResult> {
    try {
      const category = await this.database.category.update({
        where: { id: categoryId },
        data: {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.slug === undefined ? {} : { slug: input.slug }),
          ...(input.description === undefined ? {} : { description: input.description }),
          ...(input.sortOrder === undefined ? {} : { sortOrder: input.sortOrder }),
          ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
        },
      });
      return { kind: 'updated', category };
    } catch (error) {
      if (isKnownRequestError(error, 'P2025')) {
        return { kind: 'not-found' };
      }
      if (isKnownRequestError(error, 'P2002')) {
        return { kind: 'duplicate-slug' };
      }
      throw error;
    }
  }

  async delete(categoryId: string): Promise<CategoryDeleteResult> {
    return this.database.$transaction(async (transaction) => {
      const locked = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT id
        FROM categories
        WHERE id = ${categoryId}::uuid
        FOR UPDATE
      `;
      if (locked.length === 0) {
        return { kind: 'not-found' };
      }

      const productCount = await transaction.product.count({ where: { categoryId } });
      if (productCount > 0) {
        return { kind: 'not-empty' };
      }

      try {
        await transaction.category.delete({ where: { id: categoryId } });
      } catch (error) {
        if (isKnownRequestError(error, 'P2003')) {
          return { kind: 'not-empty' };
        }
        throw error;
      }
      return { kind: 'deleted' };
    });
  }
}
