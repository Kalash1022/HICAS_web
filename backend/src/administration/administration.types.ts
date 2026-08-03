import { MfaTotpStatus, UserRole, UserStatus } from '@prisma/client';

export type MfaStatus = MfaTotpStatus | 'NONE';

export interface AdminUserSummary {
  id: string;
  email: string;
  fullName: string;
  avatarUrl: string | null;
  role: UserRole;
  status: UserStatus;
  emailVerifiedAt: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  mfaStatus: MfaStatus;
}

export interface AdminUserDetail extends AdminUserSummary {
  phone: string | null;
  birthDate: Date | null;
  updatedAt: Date;
  authProviders: string[];
}
