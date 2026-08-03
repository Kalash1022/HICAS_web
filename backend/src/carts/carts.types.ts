export interface CartProductImage {
  id: string;
  url: string;
  altText: string | null;
  sortOrder: number;
  isPrimary: boolean;
}

export interface CartProductView {
  id: string;
  name: string;
  slug: string;
  price: string;
  compareAtPrice: string | null;
  primaryImage: CartProductImage | null;
  isPurchasable: boolean;
}

export interface CartItemView {
  id: string;
  quantity: number;
  lineTotal: string;
  product: CartProductView;
  createdAt: Date;
  updatedAt: Date;
}

export interface CartView {
  id: string | null;
  items: CartItemView[];
  itemCount: number;
  subtotal: string;
  updatedAt: Date | null;
}

export type CartItemMutationResult =
  | { kind: 'product-not-found' }
  | { kind: 'item-not-found' }
  | { kind: 'updated'; item: CartItemView };

export interface CartCheckoutLine {
  productId: string;
  quantity: number;
}

export type CartCheckoutRemovalResult =
  | { kind: 'cart-not-found' }
  | { kind: 'item-not-found'; productId: string }
  | {
      kind: 'insufficient-quantity';
      productId: string;
      quantity: number;
      requestedQuantity: number;
    }
  | { kind: 'removed' };
