import type { UserRole, UserStatus } from '@prisma/client';

export interface ProfileRecord {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  avatarUrl: string | null;
  birthDate: Date | null;
  role: UserRole;
  status: UserStatus;
  emailVerifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProfileView {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  avatarUrl: string | null;
  birthDate: string | null;
  role: UserRole;
  status: UserStatus;
  emailVerifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type AvatarReplacementResult =
  | { kind: 'not-found' }
  | { kind: 'updated'; profile: ProfileRecord; previousStorageKey: string | null };

export function toProfileView(profile: ProfileRecord): ProfileView {
  return {
    id: profile.id,
    email: profile.email,
    fullName: profile.fullName,
    phone: profile.phone,
    avatarUrl: profile.avatarUrl,
    birthDate: profile.birthDate?.toISOString().slice(0, 10) ?? null,
    role: profile.role,
    status: profile.status,
    emailVerifiedAt: profile.emailVerifiedAt,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}
