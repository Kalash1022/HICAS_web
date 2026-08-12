import type { Category } from '@prisma/client';

export type AdminCategory = Category;

export type CategoryMutationResult =
  { kind: 'not-found' } | { kind: 'duplicate-slug' } | { kind: 'updated'; category: AdminCategory };

export type CategoryDeleteResult =
  { kind: 'not-found' } | { kind: 'not-empty' } | { kind: 'deleted' };
