import { ConfigService } from '@nestjs/config';
import { createTransport } from 'nodemailer';

import { createSmtpTransport } from './smtp-transport.provider';

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(),
}));

const createTransportMock = createTransport as jest.MockedFunction<typeof createTransport>;

describe('createSmtpTransport', () => {
  beforeEach(() => {
    createTransportMock.mockReset();
    createTransportMock.mockReturnValue({} as ReturnType<typeof createTransport>);
  });

  it('requires STARTTLS and applies bounded timeouts in production', () => {
    createSmtpTransport(
      new ConfigService({
        NODE_ENV: 'production',
        SMTP_HOST: 'smtp.example.com',
        SMTP_PORT: 587,
        SMTP_USER: 'mailer',
        SMTP_PASSWORD: 'secret',
      }),
    );

    expect(createTransportMock).toHaveBeenCalledWith({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      requireTLS: true,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
      auth: {
        user: 'mailer',
        pass: 'secret',
      },
    });
  });

  it('does not force STARTTLS for a local development transport', () => {
    createSmtpTransport(
      new ConfigService({
        NODE_ENV: 'development',
        SMTP_HOST: 'localhost',
        SMTP_PORT: 1025,
        SMTP_USER: '',
        SMTP_PASSWORD: '',
      }),
    );

    expect(createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({
        secure: false,
        requireTLS: false,
      }),
    );
    expect(createTransportMock.mock.calls[0]?.[0]).not.toHaveProperty('auth');
  });
});
