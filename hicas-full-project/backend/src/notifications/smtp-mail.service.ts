import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { SendMailOptions, Transporter } from 'nodemailer';

import {
  MailDeliveryError,
  type EmailVerificationMail,
  type MailService,
  type MailTemplate,
  type PasswordResetMail,
} from './mail.service';
import {
  renderEmailVerificationTemplate,
  renderPasswordResetTemplate,
  type MailTemplateContent,
} from './mail.templates';
import { SMTP_TRANSPORT } from './smtp-transport.provider';

interface MessageData {
  to: string;
  fullName: string;
  token: string;
}

function safeErrorType(error: unknown): string {
  const candidate = error instanceof Error ? error.name : typeof error;
  return /^[A-Za-z][A-Za-z0-9_$]{0,63}$/.test(candidate) ? candidate : 'UnknownError';
}

function firstFrontendOrigin(value: string): string {
  const firstOrigin = value
    .split(',')
    .map((origin) => origin.trim())
    .find((origin) => origin.length > 0);

  if (!firstOrigin) {
    throw new Error('FRONTEND_ORIGIN must contain at least one origin');
  }

  return firstOrigin;
}

@Injectable()
export class SmtpMailService implements MailService {
  private readonly from: string;
  private readonly frontendOrigin: string;

  constructor(
    @Inject(SMTP_TRANSPORT)
    private readonly transport: Pick<Transporter, 'sendMail'>,
    config: ConfigService,
    @InjectPinoLogger(SmtpMailService.name)
    private readonly logger: PinoLogger,
  ) {
    this.from = config.getOrThrow<string>('MAIL_FROM');
    this.frontendOrigin = firstFrontendOrigin(config.getOrThrow<string>('FRONTEND_ORIGIN'));
  }

  async sendEmailVerification(message: EmailVerificationMail): Promise<void> {
    await this.deliver(
      'EMAIL_VERIFICATION',
      message,
      '/auth/verify-email',
      renderEmailVerificationTemplate,
    );
  }

  async sendPasswordReset(message: PasswordResetMail): Promise<void> {
    await this.deliver(
      'PASSWORD_RESET',
      message,
      '/auth/reset-password',
      renderPasswordResetTemplate,
    );
  }

  private async deliver(
    template: MailTemplate,
    message: MessageData,
    path: string,
    render: (data: { fullName: string; actionUrl: string }) => MailTemplateContent,
  ): Promise<void> {
    const actionUrl = new URL(path, this.frontendOrigin);
    actionUrl.searchParams.set('token', message.token);
    const content = render({
      fullName: message.fullName,
      actionUrl: actionUrl.toString(),
    });
    const mail: SendMailOptions = {
      from: this.from,
      to: message.to,
      subject: content.subject,
      text: content.text,
      html: content.html,
    };

    try {
      await this.transport.sendMail(mail);
    } catch (error) {
      this.logger.error(
        {
          event: 'MAIL_DELIVERY_FAILED',
          provider: 'smtp',
          template,
          errorType: safeErrorType(error),
        },
        'Mail delivery failed',
      );

      throw new MailDeliveryError('smtp', template);
    }
  }
}
