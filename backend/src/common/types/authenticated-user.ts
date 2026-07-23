import type { Request } from 'express';
import type { UserRole } from '@prisma/client';

export interface AuthenticatedUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  sessionId: string;
}

export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}
