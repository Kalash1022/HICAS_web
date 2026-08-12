import { ConfigService } from '@nestjs/config';
import type { PinoLogger } from 'nestjs-pino';
import type { SendMailOptions } from 'nodemailer';

import { MailDeliveryError } from './mail.service';
import { SmtpMailService } from './smtp-mail.service';

describe('SmtpMailService', () => {
  const config = new ConfigService({
    MAIL_FROM: 'no-reply@hicas.test',
    FRONTEND_ORIGIN: 'https://shop.hicas.test,https://admin.hicas.test',
  });
  let sendMail: jest.Mock<Promise<unknown>, [SendMailOptions]>;
  let loggerError: jest.Mock;
  let service: SmtpMailService;

  beforeEach(() => {
    sendMail = jest.fn<Promise<unknown>, [SendMailOptions]>().mockResolvedValue({});
    loggerError = jest.fn();
    service = new SmtpMailService({ sendMail }, config, {
      error: loggerError,
    } as unknown as PinoLogger);
  });

  it('sends an email verification link using the first configured frontend origin', async () => {
    const token = 'verify-token+/=';

    await service.sendEmailVerification({
      to: 'customer@example.com',
      fullName: 'Customer',
      token,
    });

    expect(sendMail).toHaveBeenCalledTimes(1);
    const message = sendMail.mock.calls[0]?.[0];
    expect(message).toMatchObject({
      from: 'no-reply@hicas.test',
      to: 'customer@example.com',
      subject: 'Xác minh địa chỉ email HICAS Commerce',
    });
    expect(message?.text).toContain(
      'https://shop.hicas.test/auth/verify-email?token=verify-token%2B%2F%3D',
    );
    expect(loggerError).not.toHaveBeenCalled();
  });

  it('sends a password reset link with the reset template', async () => {
    await service.sendPasswordReset({
      to: 'customer@example.com',
      fullName: 'Customer',
      token: 'reset-token',
    });

    expect(sendMail).toHaveBeenCalledTimes(1);
    const message = sendMail.mock.calls[0]?.[0];
    expect(message?.subject).toBe('Đặt lại mật khẩu HICAS Commerce');
    expect(message?.text).toContain(
      'https://shop.hicas.test/auth/reset-password?token=reset-token',
    );
  });

  it('logs only redacted metadata and throws a sanitized delivery error', async () => {
    const token = 'raw-secret-token';
    const recipient = 'customer@example.com';
    sendMail.mockRejectedValueOnce(new Error(`SMTP rejected ${recipient}: ${token}`));

    const promise = service.sendEmailVerification({
      to: recipient,
      fullName: 'Customer',
      token,
    });

    await expect(promise).rejects.toEqual(new MailDeliveryError('smtp', 'EMAIL_VERIFICATION'));
    expect(loggerError).toHaveBeenCalledWith(
      {
        event: 'MAIL_DELIVERY_FAILED',
        provider: 'smtp',
        template: 'EMAIL_VERIFICATION',
        errorType: 'Error',
      },
      'Mail delivery failed',
    );

    const serializedLog = JSON.stringify(loggerError.mock.calls);
    expect(serializedLog).not.toContain(token);
    expect(serializedLog).not.toContain(recipient);
    await expect(promise).rejects.not.toHaveProperty('cause');
  });
});
