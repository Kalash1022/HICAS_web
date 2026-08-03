import type {
  CurrencyCode,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
} from '@prisma/client';

import type { ShippingAddressSnapshot } from '../addresses/addresses.types';

export interface CheckoutLine {
  productId: string;
  quantity: number;
}

export interface CanonicalCheckoutRequest {
  idempotencyKey: string;
  addressId: string;
  customerNote: string | null;
  items: CheckoutLine[];
  canonicalJson: string;
  requestHash: string;
}

export interface CheckoutProduct {
  id: string;
  name: string;
  sku: string;
  price: Prisma.Decimal;
  primaryImageUrl: string | null;
}

export interface CheckoutOrderLine extends CheckoutLine {
  product: CheckoutProduct;
  unitPrice: Prisma.Decimal;
  lineTotal: Prisma.Decimal;
}

export interface OrderItemView {
  id: string;
  productId: string | null;
  productName: string;
  productSku: string;
  productImageUrl: string | null;
  unitPrice: string;
  quantity: number;
  lineTotal: string;
}

export interface OrderSummary {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  subtotal: string;
  shippingFee: string;
  discountAmount: string;
  totalAmount: string;
  currency: CurrencyCode;
  itemCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrderStatusHistoryView {
  id: string;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  note: string | null;
  createdAt: Date;
}

export interface OrderDetail extends OrderView {
  statusHistory: OrderStatusHistoryView[];
}

export interface OrderCustomerView {
  id: string;
  email: string;
  fullName: string;
}

export interface AdminOrderSummary extends OrderSummary {
  customer: OrderCustomerView;
}

export interface AdminOrderDetail extends OrderDetail {
  customer: OrderCustomerView;
}

export interface OrderInventoryLine {
  productId: string | null;
  quantity: number;
}

export interface LockedOrder {
  id: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  paidAt: Date | null;
}

export interface OrderView {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  paidAt: Date | null;
  subtotal: string;
  shippingFee: string;
  discountAmount: string;
  totalAmount: string;
  currency: CurrencyCode;
  shippingSnapshot: ShippingAddressSnapshot;
  customerNote: string | null;
  items: OrderItemView[];
  createdAt: Date;
  updatedAt: Date;
}

export interface StoredOrder {
  order: OrderView;
  idempotencyRequestHash: string;
}

export interface CheckoutResult {
  order: OrderView;
  replayed: boolean;
}

export interface CreatePendingOrderInput {
  orderNumber: string;
  userId: string;
  shippingSnapshot: ShippingAddressSnapshot;
  customerNote: string | null;
  idempotencyKey: string;
  idempotencyRequestHash: string;
  subtotal: Prisma.Decimal;
  shippingFee: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
  lines: CheckoutOrderLine[];
}
