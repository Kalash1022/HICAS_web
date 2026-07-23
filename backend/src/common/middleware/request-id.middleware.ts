import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { getOrCreateRequestId, type RequestWithId } from './request-id';

export type HttpRequestWithId = Request & RequestWithId;

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(request: HttpRequestWithId, response: Response, next: NextFunction): void {
    getOrCreateRequestId(request, response);
    next();
  }
}
