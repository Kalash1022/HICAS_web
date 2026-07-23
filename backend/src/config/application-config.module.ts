import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { environmentSchema } from './environment.schema';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      expandVariables: false,
      validationSchema: environmentSchema,
      validationOptions: {
        abortEarly: false,
        allowUnknown: true,
        convert: true,
      },
    }),
  ],
  exports: [ConfigModule],
})
export class ApplicationConfigModule {}
