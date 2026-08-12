import { ProductStatus } from '@prisma/client';

export interface ProductCategorySummary {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
}

export interface ProductInventorySummary {
  quantity: number;
  reservedQuantity: number;
  version: number;
  updatedAt: Date;
}

export interface ProductImageSummary {
  id: string;
  url: string;
  altText: string | null;
  sortOrder: number;
  isPrimary: boolean;
  createdAt: Date;
}

export interface AdminProductSummary {
  id: string;
  categoryId: string;
  name: string;
  slug: string;
  sku: string;
  description: string | null;
  price: string;
  compareAtPrice: string | null;
  status: ProductStatus;
  createdAt: Date;
  updatedAt: Date;
  category: ProductCategorySummary;
  inventory: ProductInventorySummary | null;
  primaryImage: ProductImageSummary | null;
}

export interface AdminProductDetail extends Omit<AdminProductSummary, 'primaryImage'> {
  images: ProductImageSummary[];
}

export type ProductImageMutationResult =
  | { kind: 'product-not-found' }
  | { kind: 'image-not-found' }
  | { kind: 'active-product-image-required' }
  | { kind: 'max-images' }
  | { kind: 'attached'; image: ProductImageSummary }
  | { kind: 'deleted'; storageKey: string };

export type ProductMutationResult =
  | { kind: 'not-found' }
  | { kind: 'category-not-found' }
  | { kind: 'duplicate-slug' }
  | { kind: 'duplicate-sku' }
  | { kind: 'invalid-price' }
  | { kind: 'cannot-activate'; reasons: string[] }
  | { kind: 'updated'; product: AdminProductDetail };
