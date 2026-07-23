import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { REFRESH_TOKEN_COOKIE } from './auth/auth.constants';
import { parseAllowedOrigins } from './config/origins';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService);

  app.set('trust proxy', config.getOrThrow<number>('TRUST_PROXY_HOPS'));
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  app.use(cookieParser());
  app.use(
    helmet({
      // Swagger UI contains inline scripts; all other Helmet protections remain enabled.
      contentSecurityPolicy: false,
    }),
  );
  app.enableCors({
    origin: parseAllowedOrigins(config.getOrThrow<string>('FRONTEND_ORIGIN')),
    credentials: true,
  });
  app.setGlobalPrefix('api/v1', {
    exclude: [
      { path: 'health/live', method: RequestMethod.GET },
      { path: 'health/ready', method: RequestMethod.GET },
    ],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('HICAS Commerce API')
    .setDescription('Lean MVP API for the HICAS Commerce storefront and administration portal')
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
      'access-token',
    )
    .addCookieAuth(
      REFRESH_TOKEN_COOKIE,
      {
        type: 'apiKey',
        in: 'cookie',
      },
      REFRESH_TOKEN_COOKIE,
    )
    .build();
  const openApiDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, openApiDocument, {
    jsonDocumentUrl: 'api/docs-json',
  });

  await app.listen(config.getOrThrow<number>('PORT'), '0.0.0.0');
}

void bootstrap().catch((error: unknown) => {
  const errorType = error instanceof Error ? error.constructor.name : typeof error;
  process.stderr.write(`Backend bootstrap failed (${errorType}).\n`);
  process.exitCode = 1;
});
