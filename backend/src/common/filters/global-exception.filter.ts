import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

import type { ApplicationErrorResponse } from '../exceptions/application.exception';
import { getOrCreateRequestId, type RequestWithId } from '../middleware/request-id';

interface ApiErrorBody {
  error: ApplicationErrorResponse;
  meta: {
    requestId: string;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function defaultErrorCode(status: number): string {
  const codes: Partial<Record<number, string>> = {
    [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
    [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
    [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
    [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
    [HttpStatus.CONFLICT]: 'CONFLICT',
    [HttpStatus.TOO_MANY_REQUESTS]: 'RATE_LIMIT_EXCEEDED',
    [HttpStatus.SERVICE_UNAVAILABLE]: 'SERVICE_UNAVAILABLE',
  };

  return codes[status] ?? (status >= 500 ? 'INTERNAL_SERVER_ERROR' : 'HTTP_ERROR');
}

function normalizeHttpException(exception: HttpException): ApplicationErrorResponse {
  const status = exception.getStatus();
  const response = exception.getResponse();

  if (typeof response === 'string') {
    return { code: defaultErrorCode(status), message: response };
  }

  if (!isRecord(response)) {
    return {
      code: defaultErrorCode(status),
      message: exception.message,
    };
  }

  const rawMessage = response.message;
  const code =
    typeof response.code === 'string'
      ? response.code
      : Array.isArray(rawMessage)
        ? 'VALIDATION_FAILED'
        : defaultErrorCode(status);
  const message = Array.isArray(rawMessage)
    ? 'Request validation failed'
    : typeof rawMessage === 'string'
      ? rawMessage
      : exception.message;
  const details =
    response.details ??
    (Array.isArray(rawMessage)
      ? { messages: rawMessage.filter((item) => typeof item === 'string') }
      : undefined);

  return {
    code,
    message,
    ...(details === undefined ? {} : { details }),
  };
}

function exceptionType(exception: unknown): string {
  return exception instanceof Error ? exception.constructor.name : typeof exception;
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(
    @InjectPinoLogger(GlobalExceptionFilter.name)
    private readonly logger: PinoLogger,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request & RequestWithId>();
    const response = http.getResponse<Response>();
    const requestId = getOrCreateRequestId(request, response);
    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const error =
      exception instanceof HttpException
        ? normalizeHttpException(exception)
        : {
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Internal server error',
          };

    if (status >= 500) {
      this.logger.error(
        {
          requestId,
          method: request.method,
          path: request.originalUrl,
          exceptionType: exceptionType(exception),
        },
        'Unhandled request exception',
      );
    }

    if (response.headersSent) {
      return;
    }

    const body: ApiErrorBody = {
      error,
      meta: { requestId },
    };

    response.status(status).json(body);
  }
}
