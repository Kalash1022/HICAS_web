import { createHash, randomUUID } from 'node:crypto';

import { HttpStatus } from '@nestjs/common';
import { isUUID } from 'class-validator';

import { ApplicationException } from '../common/exceptions/application.exception';
import type { CreateOrderDto } from './dto/create-order.dto';
import type { CanonicalCheckoutRequest, CheckoutLine } from './orders.types';

const MAX_POSTGRES_INTEGER = 2_147_483_647;
const MAX_IDEMPOTENCY_KEY_LENGTH = 255;

export function prepareCheckoutRequest(
  dto: CreateOrderDto,
  rawIdempotencyKey: unknown,
): CanonicalCheckoutRequest {
  const idempotencyKey = normalizeIdempotencyKey(rawIdempotencyKey);
  const addressId = normalizeUuid(dto.addressId, 'addressId');
  const items = normalizeCheckoutLines(dto.items);
  const customerNote = normalizeCustomerNote(dto.customerNote);
  const canonicalJson = JSON.stringify({ addressId, customerNote, items });

  return {
    idempotencyKey,
    addressId,
    customerNote,
    items,
    canonicalJson,
    requestHash: createHash('sha256').update(canonicalJson, 'utf8').digest('hex'),
  };
}

export function generateOrderNumber(now: Date = new Date()): string {
  const date = now.toISOString().slice(0, 10).replaceAll('-', '');
  const nonce = randomUUID().replaceAll('-', '').slice(0, 16).toUpperCase();
  return `ORD-${date}-${nonce}`;
}

function normalizeIdempotencyKey(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ApplicationException(
      HttpStatus.BAD_REQUEST,
      'IDEMPOTENCY_KEY_REQUIRED',
      'An Idempotency-Key header is required for checkout.',
    );
  }
  const normalized = value.trim();
  if (normalized.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw new ApplicationException(
      HttpStatus.BAD_REQUEST,
      'IDEMPOTENCY_KEY_INVALID',
      `Idempotency-Key must be at most ${MAX_IDEMPOTENCY_KEY_LENGTH} characters.`,
    );
  }
  return normalized;
}

function normalizeUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ApplicationException(
      HttpStatus.BAD_REQUEST,
      'ORDER_REQUEST_INVALID',
      `${field} must be a UUID.`,
    );
  }
  const normalized = value.trim().toLowerCase();
  if (!isUUID(normalized, '4')) {
    throw new ApplicationException(
      HttpStatus.BAD_REQUEST,
      'ORDER_REQUEST_INVALID',
      `${field} must be a UUID.`,
    );
  }
  return normalized;
}

function normalizeCheckoutLines(lines: unknown): CheckoutLine[] {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new ApplicationException(
      HttpStatus.BAD_REQUEST,
      'ORDER_ITEMS_REQUIRED',
      'At least one order item is required.',
    );
  }

  const quantitiesByProductId = new Map<string, number>();
  for (const line of lines) {
    if (!isCheckoutLine(line)) {
      throw new ApplicationException(
        HttpStatus.BAD_REQUEST,
        'ORDER_ITEM_INVALID',
        'Each order item must have a product ID and a positive integer quantity.',
      );
    }
    const productId = normalizeUuid(line.productId, 'items.productId');
    if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0) {
      throw new ApplicationException(
        HttpStatus.BAD_REQUEST,
        'ORDER_ITEM_INVALID',
        'Each order item must have a positive integer quantity.',
      );
    }
    const quantity = (quantitiesByProductId.get(productId) ?? 0) + line.quantity;
    if (!Number.isSafeInteger(quantity) || quantity > MAX_POSTGRES_INTEGER) {
      throw new ApplicationException(
        HttpStatus.BAD_REQUEST,
        'ORDER_ITEM_INVALID',
        'The requested quantity is too large.',
        { productId },
      );
    }
    quantitiesByProductId.set(productId, quantity);
  }

  return [...quantitiesByProductId.entries()]
    .sort(([leftProductId], [rightProductId]) => leftProductId.localeCompare(rightProductId))
    .map(([productId, quantity]) => ({ productId, quantity }));
}

function isCheckoutLine(value: unknown): value is CheckoutLine {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.productId === 'string' && typeof record.quantity === 'number';
}

function normalizeCustomerNote(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}
