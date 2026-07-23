import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { MAIL_SERVICE } from './mail.service';
import { SmtpMailService } from './smtp-mail.service';
import { smtpTransportProvider } from './smtp-transport.provider';

@Module({
  imports: [ConfigModule],
  providers: [
    smtpTransportProvider,
    SmtpMailService,
    {
      provide: MAIL_SERVICE,
      useExisting: SmtpMailService,
    },
  ],
  exports: [MAIL_SERVICE],
})
export class NotificationsModule {}
