import {
  Body,
  Controller,
  Get,
  INestApplication,
  Module,
  Post,
  RequestMethod,
  ValidationPipe,
} from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { IsString } from 'class-validator';
import type { NextFunction, Request, Response } from 'express';
import type { Server } from 'node:http';
import { getLoggerToken } from 'nestjs-pino';
import { MulterError } from 'multer';
import request from 'supertest';

import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import { ResponseEnvelopeInterceptor } from '../src/common/interceptors/response-envelope.interceptor';
import { RequestIdMiddleware } from '../src/common/middleware/request-id.middleware';
import { HealthController } from '../src/health/health.controller';
import { HealthService } from '../src/health/health.service';

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Expected an object response body');
  }

  return value as Record<string, unknown>;
}

class NameDto {
  @IsString()
  name!: string;
}

@Controller('foundation-test')
class FoundationTestController {
  @Get()
  success(): { value: string } {
    return { value: 'ok' };
  }

  @Get('page')
  page(): {
    data: string[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  } {
    return {
      data: ['one'],
      pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
    };
  }

  @Post()
  validate(@Body() body: NameDto): NameDto {
    return body;
  }

  @Get('failure')
  failure(): never {
    throw new Error('sensitive internal detail');
  }

  @Get('upload-too-large')
  uploadTooLarge(): never {
    throw new MulterError('LIMIT_FILE_SIZE');
  }
}

@Module({
  controllers: [FoundationTestController, HealthController],
  providers: [
    {
      provide: HealthService,
      useValue: {
        live: () => ({ status: 'ok', timestamp: '2026-07-23T00:00:00.000Z' }),
        ready: () => Promise.resolve({ status: 'ok', timestamp: '2026-07-23T00:00:00.000Z' }),
      },
    },
    {
      provide: getLoggerToken(GlobalExceptionFilter.name),
      useValue: { error: jest.fn() },
    },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor },
  ],
})
class FoundationTestModule {}

describe('backend foundation (e2e)', () => {
  let app: INestApplication;
  let httpServer: Server;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [FoundationTestModule],
    }).compile();

    app = moduleRef.createNestApplication();
    const requestIdMiddleware = new RequestIdMiddleware();
    app.use((requestMessage: Request, responseMessage: Response, next: NextFunction) => {
      requestIdMiddleware.use(requestMessage, responseMessage, next);
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
      }),
    );
    await app.init();
    httpServer = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  it('wraps successful responses and propagates a safe request ID', async () => {
    const response = await request(httpServer)
      .get('/api/v1/foundation-test')
      .set('X-Request-Id', 'browser-request-1')
      .expect(200);

    expect(response.headers['x-request-id']).toBe('browser-request-1');
    expect(response.body).toEqual({
      data: { value: 'ok' },
      meta: { requestId: 'browser-request-1' },
    });
  });

  it('preserves pagination at the top level', async () => {
    const response = await request(httpServer).get('/api/v1/foundation-test/page').expect(200);

    expect(response.body).toMatchObject({
      data: ['one'],
      pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
      meta: { requestId: expect.any(String) as string },
    });
  });

  it('returns the stable error contract for validation failures', async () => {
    const response = await request(httpServer)
      .post('/api/v1/foundation-test')
      .send({ name: 123, unexpected: true })
      .expect(400);

    expect(response.body).toMatchObject({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Request validation failed',
      },
      meta: { requestId: expect.any(String) as string },
    });
  });

  it('does not leak an unhandled exception message', async () => {
    const response = await request(httpServer).get('/api/v1/foundation-test/failure').expect(500);

    expect(asRecord(response.body as unknown).error).toEqual({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Internal server error',
    });
    expect(JSON.stringify(response.body)).not.toContain('sensitive internal detail');
  });

  it('maps multipart limits to a stable client error instead of an internal error', async () => {
    const response = await request(httpServer)
      .get('/api/v1/foundation-test/upload-too-large')
      .expect(413);

    expect(asRecord(response.body as unknown).error).toEqual({
      code: 'IMAGE_FILE_TOO_LARGE',
      message: 'Images must be at most 5 MB.',
    });
  });

  it('serves liveness outside the versioned API prefix', async () => {
    const response = await request(httpServer).get('/health/live').expect(200);

    expect(asRecord(response.body as unknown).data).toEqual({
      status: 'ok',
      timestamp: '2026-07-23T00:00:00.000Z',
    });
  });
});
