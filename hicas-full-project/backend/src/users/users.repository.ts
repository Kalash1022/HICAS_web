import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { DatabaseService } from '../database/database.service';
import type { UpdateProfileDto } from './dto/update-profile.dto';
import type { AvatarReplacementResult, ProfileRecord } from './users.types';

const profileSelect = {
  id: true,
  email: true,
  fullName: true,
  phone: true,
  avatarUrl: true,
  birthDate: true,
  role: true,
  status: true,
  emailVerifiedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

interface LockedAvatarUser {
  id: string;
  avatarStorageKey: string | null;
}

function isKnownRequestError(error: unknown, code: string): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}

@Injectable()
export class UsersRepository {
  constructor(private readonly database: DatabaseService) {}

  findProfile(userId: string): Promise<ProfileRecord | null> {
    return this.database.user.findUnique({
      where: { id: userId },
      select: profileSelect,
    });
  }

  async updateProfile(input: {
    userId: string;
    dto: UpdateProfileDto;
    birthDate: Date | null | undefined;
  }): Promise<ProfileRecord | null> {
    try {
      return await this.database.user.update({
        where: { id: input.userId },
        data: {
          ...(input.dto.fullName === undefined ? {} : { fullName: input.dto.fullName }),
          ...(input.dto.phone === undefined ? {} : { phone: input.dto.phone }),
          ...(input.birthDate === undefined ? {} : { birthDate: input.birthDate }),
        },
        select: profileSelect,
      });
    } catch (error) {
      if (isKnownRequestError(error, 'P2025')) {
        return null;
      }
      throw error;
    }
  }

  async replaceAvatar(input: {
    userId: string;
    avatarUrl: string;
    storageKey: string;
  }): Promise<AvatarReplacementResult> {
    return this.database.$transaction(async (transaction) => {
      const locked = await transaction.$queryRaw<LockedAvatarUser[]>(
        Prisma.sql`
          SELECT id, avatar_storage_key AS "avatarStorageKey"
          FROM users
          WHERE id = ${input.userId}::uuid
          FOR UPDATE
        `,
      );
      const previous = locked[0];
      if (!previous) {
        return { kind: 'not-found' };
      }

      const profile = await transaction.user.update({
        where: { id: previous.id },
        data: {
          avatarUrl: input.avatarUrl,
          avatarStorageKey: input.storageKey,
        },
        select: profileSelect,
      });
      return {
        kind: 'updated',
        profile,
        previousStorageKey: previous.avatarStorageKey,
      };
    });
  }
}
