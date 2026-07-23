import type { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';

export const SMTP_TRANSPORT = Symbol('SMTP_TRANSPORT');

export function createSmtpTransport(config: ConfigService): Transporter {
  const port = config.getOrThrow<number>('SMTP_PORT');
  const user = config.get<string>('SMTP_USER', '');
  const password = config.get<string>('SMTP_PASSWORD', '');
  const isProduction = config.get<string>('NODE_ENV', 'development') === 'production';
  const options: SMTPTransport.Options = {
    host: config.getOrThrow<string>('SMTP_HOST'),
    port,
    secure: port === 465,
    requireTLS: isProduction && port !== 465,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  };

  if (user.length > 0 && password.length > 0) {
    options.auth = {
      user,
      pass: password,
    };
  }

  return createTransport(options);
}

export const smtpTransportProvider: Provider = {
  provide: SMTP_TRANSPORT,
  inject: [ConfigService],
  useFactory: createSmtpTransport,
};
