import type { UserRole, UserStatus } from '@prisma/client';

export interface RequestContext {
  ipAddress?: string;
  userAgent?: string;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
}

export interface AccessTokenClaims {
  sub: string;
  sid: string;
  role: UserRole;
  type: 'access';
  iat?: number;
  exp?: number;
}

export interface PasswordLoginRecord {
  id: string;
  email: string;
  emailNormalized: string;
  fullName: string;
  role: UserRole;
  status: UserStatus;
  emailVerifiedAt: Date | null;
  passwordHash: string | null;
}

export interface SessionAuthenticationResult {
  kind: 'session';
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
  user: AuthenticatedUser;
}

export interface PublicSessionAuthenticationResult {
  accessToken: string;
  expiresIn: number;
  user: AuthenticatedUser;
}

export interface MfaEnrollmentAuthenticationResult {
  kind: 'mfa-enrollment';
  mfaEnrollmentRequired: true;
  enrollmentToken: string;
  expiresIn: number;
}

export interface MfaChallengeAuthenticationResult {
  kind: 'mfa-challenge';
  mfaRequired: true;
  mfaToken: string;
  expiresIn: number;
}

export type AuthenticationResult =
  | SessionAuthenticationResult
  | MfaEnrollmentAuthenticationResult
  | MfaChallengeAuthenticationResult;

export type PublicAuthenticationResult =
  | PublicSessionAuthenticationResult
  | Omit<MfaEnrollmentAuthenticationResult, 'kind'>
  | Omit<MfaChallengeAuthenticationResult, 'kind'>;
