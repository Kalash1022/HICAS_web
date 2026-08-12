export interface PublicProductCategory {
  id: string;
  name: string;
  slug: string;
}

export interface PublicProductImage {
  id: string;
  url: string;
  altText: string | null;
  sortOrder: number;
  isPrimary: boolean;
}

export interface PublicProductSummary {
  id: string;
  name: string;
  slug: string;
  price: string;
  compareAtPrice: string | null;
  category: PublicProductCategory;
  primaryImage: PublicProductImage | null;
  createdAt: Date;
}

export interface PublicProductDetail extends Omit<PublicProductSummary, 'primaryImage'> {
  description: string | null;
  images: PublicProductImage[];
}
