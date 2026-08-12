import type { Address } from '@prisma/client';

export interface AddressView {
  id: string;
  recipientName: string;
  phone: string;
  province: string;
  district: string;
  ward: string;
  street: string;
  postalCode: string | null;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * This is copied into Order.shippingSnapshot during checkout. It deliberately
 * has no Address ID: later address edits or deletion must not affect an order.
 */
export interface ShippingAddressSnapshot {
  recipientName: string;
  phone: string;
  province: string;
  district: string;
  ward: string;
  street: string;
  postalCode: string | null;
}

export type AddressMutationResult =
  { kind: 'not-found' } | { kind: 'default-conflict' } | { kind: 'updated'; address: Address };

export type AddressDeleteResult = { kind: 'not-found' } | { kind: 'deleted' };

export function toAddressView(address: Address): AddressView {
  return {
    id: address.id,
    recipientName: address.recipientName,
    phone: address.phone,
    province: address.province,
    district: address.district,
    ward: address.ward,
    street: address.street,
    postalCode: address.postalCode,
    isDefault: address.isDefault,
    createdAt: address.createdAt,
    updatedAt: address.updatedAt,
  };
}
