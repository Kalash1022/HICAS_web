export const MAIL_SERVICE = Symbol('MAIL_SERVICE');

export interface EmailVerificationMail {
  to: string;
  fullName: string;
  token: string;
}

export interface PasswordResetMail {
  to: string;
  fullName: string;
  token: string;
}

export interface MailService {
  sendEmailVerification(message: EmailVerificationMail): Promise<void>;
  sendPasswordReset(message: PasswordResetMail): Promise<void>;
}

export type MailTemplate = 'EMAIL_VERIFICATION' | 'PASSWORD_RESET';

/**
 * Safe for the Auth module to catch after its database transaction commits.
 *
 * Intentionally does not retain the recipient, raw token, SMTP response, or
 * original error as a public property. Those values must never reach request
 * error logging.
 */
export class MailDeliveryError extends Error {
  readonly code = 'MAIL_DELIVERY_FAILED';

  constructor(
    readonly provider: 'smtp',
    readonly template: MailTemplate,
  ) {
    super('Mail delivery failed');
    this.name = 'MailDeliveryError';
  }
}
