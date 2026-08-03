import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { ApplicationException } from '../common/exceptions/application.exception';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { AddressesRepository } from './addresses.repository';
import type { CreateAddressDto } from './dto/create-address.dto';
import type { UpdateAddressDto } from './dto/update-address.dto';
import { type AddressView, type ShippingAddressSnapshot, toAddressView } from './addresses.types';

@Injectable()
export class AddressesService {
  constructor(private readonly repository: AddressesRepository) {}

  async list(actor: AuthenticatedUser): Promise<AddressView[]> {
    const addresses = await this.repository.listForUser(actor.id);
    return addresses.map(toAddressView);
  }

  async create(input: { actor: AuthenticatedUser; dto: CreateAddressDto }): Promise<AddressView> {
    const result = await this.repository.create({ userId: input.actor.id, dto: input.dto });
    if (result.kind === 'updated') {
      return toAddressView(result.address);
    }
    this.throwDefaultConflict();
  }

  async update(input: {
    actor: AuthenticatedUser;
    addressId: string;
    dto: UpdateAddressDto;
  }): Promise<AddressView> {
    const result = await this.repository.update({
      userId: input.actor.id,
      addressId: input.addressId,
      dto: input.dto,
    });
    if (result.kind === 'updated') {
      return toAddressView(result.address);
    }
    if (result.kind === 'not-found') {
      this.throwAddressNotFound();
    }
    this.throwDefaultConflict();
  }

  async delete(input: { actor: AuthenticatedUser; addressId: string }): Promise<{ deleted: true }> {
    const result = await this.repository.delete({
      userId: input.actor.id,
      addressId: input.addressId,
    });
    if (result.kind === 'deleted') {
      return { deleted: true };
    }
    this.throwAddressNotFound();
  }

  /**
   * Used by checkout inside its outer transaction. No client-provided shipping
   * fields can bypass this ownership check or become an order snapshot.
   */
  async getOwnedShippingSnapshot(
    transaction: Prisma.TransactionClient,
    userId: string,
    addressId: string,
  ): Promise<ShippingAddressSnapshot> {
    const snapshot = await this.repository.lockOwnedShippingSnapshot(transaction, {
      userId,
      addressId,
    });
    if (!snapshot) {
      this.throwAddressNotFound();
    }
    return snapshot;
  }

  private throwAddressNotFound(): never {
    throw new ApplicationException(HttpStatus.NOT_FOUND, 'ADDRESS_NOT_FOUND', 'Address not found.');
  }

  private throwDefaultConflict(): never {
    throw new ApplicationException(
      HttpStatus.CONFLICT,
      'ADDRESS_DEFAULT_CONFLICT',
      'The default address changed. Please try again.',
    );
  }
}
