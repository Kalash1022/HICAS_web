import {
  CallHandler,
  ExecutionContext,
  Injectable,
  StreamableFile,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { type Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import { getOrCreateRequestId, type RequestWithId } from '../middleware/request-id';

export interface PaginationMetadata {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: PaginationMetadata;
}

interface ResponseMetadata {
  requestId: string;
}

export interface ApiSuccessResponse<T> {
  data: T;
  meta: ResponseMetadata;
  pagination?: PaginationMetadata;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isPaginationMetadata(value: unknown): value is PaginationMetadata {
  return (
    isRecord(value) &&
    typeof value.page === 'number' &&
    typeof value.limit === 'number' &&
    typeof value.total === 'number' &&
    typeof value.totalPages === 'number'
  );
}

function isPaginatedResult(value: unknown): value is PaginatedResult<unknown> {
  return isRecord(value) && Array.isArray(value.data) && isPaginationMetadata(value.pagination);
}

@Injectable()
export class ResponseEnvelopeInterceptor<T> implements NestInterceptor<
  T,
  ApiSuccessResponse<T | null | unknown[]>
> {
  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiSuccessResponse<T | null | unknown[]>> {
    const request = context.switchToHttp().getRequest<Request & RequestWithId>();
    const requestId = getOrCreateRequestId(request);

    return next.handle().pipe(
      map((data) => {
        if (data instanceof StreamableFile) {
          return data as unknown as ApiSuccessResponse<T | null | unknown[]>;
        }

        if (isPaginatedResult(data)) {
          return {
            data: data.data,
            pagination: data.pagination,
            meta: { requestId },
          };
        }

        return {
          data: data ?? null,
          meta: { requestId },
        };
      }),
    );
  }
}
