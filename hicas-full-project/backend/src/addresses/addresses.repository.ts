import { Injectable } from '@nestjs/common';
import { Prisma, type Address } from '@prisma/client';

import { DatabaseService } from '../database/database.service';
import type { CreateAddressDto } from './dto/create-address.dto';
import type { UpdateAddressDto } from './dto/update-address.dto';
import type {
  AddressDeleteResult,
  AddressMutationResult,
  ShippingAddressSnapshot,
} from './addresses.types';

interface LockedRow {
  id: string;
}

function isKnownRequestError(error: unknown, code: string): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}

@Injectable()
export class AddressesRepository {
  constructor(private readonly database: DatabaseService) {}

  listForUser(userId: string): Promise<Address[]> {
    return this.database.address.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  async create(input: { userId: string; dto: CreateAddressDto }): Promise<AddressMutationResult> {
    try {
      return await this.database.$transaction(async (transaction) => {
        await this.lockUserById(transaction, input.userId);
        if (input.dto.isDefault === true) {
          await transaction.address.updateMany({
            where: { userId: input.userId, isDefault: true },
            data: { isDefault: false },
          });
        }

        const address = await transaction.address.create({
          data: {
            userId: input.userId,
            recipientName: input.dto.recipientName,
            phone: input.dto.phone,
            province: input.dto.province,
            district: input.dto.district,
            ward: input.dto.ward,
            street: input.dto.street,
            postalCode: input.dto.postalCode ?? null,
            isDefault: input.dto.isDefault ?? false,
          },
        });
        return { kind: 'updated', address };
      });
    } catch (error) {
      // The user-row lock serializes normal requests. The partial unique index
      // remains a defensive backstop for writers outside this repository.
      if (isKnownRequestError(error, 'P2002')) {
        return { kind: 'default-conflict' };
      }
      throw error;
    }
  }

  async update(input: {
    userId: string;
    addressId: string;
    dto: UpdateAddressDto;
  }): Promise<AddressMutationResult> {
    try {
      return await this.database.$transaction(async (transaction) => {
        await this.lockUserById(transaction, input.userId);
        const addressExists = await this.lockOwnedAddress(
          transaction,
          input.userId,
          input.addressId,
        );
        if (!addressExists) {
          return { kind: 'not-found' };
        }

        if (input.dto.isDefault === true) {
          await transaction.address.updateMany({
            where: {
              userId: input.userId,
              isDefault: true,
              id: { not: input.addressId },
            },
            data: { isDefault: false },
          });
        }

        const address = await transaction.address.update({
          where: { id: input.addressId },
          data: {
            ...this.toUpdateData(input.dto),
            ...(input.dto.isDefault === undefined ? {} : { isDefault: input.dto.isDefault }),
          },
        });
        return { kind: 'updated', address };
      });
    } catch (error) {
      if (isKnownRequestError(error, 'P2002')) {
        return { kind: 'default-conflict' };
      }
      throw error;
    }
  }

  async delete(input: { userId: string; addressId: string }): Promise<AddressDeleteResult> {
    return this.database.$transaction(async (transaction) => {
      await this.lockUserById(transaction, input.userId);
      const addressExists = await this.lockOwnedAddress(transaction, input.userId, input.addressId);
      if (!addressExists) {
        return { kind: 'not-found' };
      }

      await transaction.address.delete({ where: { id: input.addressId } });
      return { kind: 'deleted' };
    });
  }

  /**
   * Checkout passes its existing transaction so the snapshot originates from a
   * single committed address row and cannot drift during order creation.
   */
  async lockOwnedShippingSnapshot(
    transaction: Prisma.TransactionClient,
    input: { userId: string; addressId: string },
  ): Promise<ShippingAddressSnapshot | null> {
    const rows = await transaction.$queryRaw<ShippingAddressSnapshot[]>(Prisma.sql`
      SELECT
        recipient_name AS "recipientName",
        phone,
        province,
        district,
        ward,
        street,
        postal_code AS "postalCode"
      FROM addresses
      WHERE id = ${input.addressId}::uuid
        AND user_id = ${input.userId}::uuid
      FOR SHARE
    `);
    return rows[0] ?? null;
  }

  private async lockUserById(transaction: Prisma.TransactionClient, userId: string): Promise<void> {
    await transaction.$queryRaw<LockedRow[]>`
      SELECT id
      FROM users
      WHERE id = ${userId}::uuid
      FOR UPDATE
    `;
  }

  private async lockOwnedAddress(
    transaction: Prisma.TransactionClient,
    userId: string,
    addressId: string,
  ): Promise<boolean> {
    const rows = await transaction.$queryRaw<LockedRow[]>`
      SELECT id
      FROM addresses
      WHERE id = ${addressId}::uuid
        AND user_id = ${userId}::uuid
      FOR UPDATE
    `;
    return rows.length === 1;
  }

  private toUpdateData(dto: UpdateAddressDto): Prisma.AddressUpdateInput {
    return {
      ...(dto.recipientName === undefined ? {} : { recipientName: dto.recipientName }),
      ...(dto.phone === undefined ? {} : { phone: dto.phone }),
      ...(dto.province === undefined ? {} : { province: dto.province }),
      ...(dto.district === undefined ? {} : { district: dto.district }),
      ...(dto.ward === undefined ? {} : { ward: dto.ward }),
      ...(dto.street === undefined ? {} : { street: dto.street }),
      ...(dto.postalCode === undefined ? {} : { postalCode: dto.postalCode }),
    };
  }
}
