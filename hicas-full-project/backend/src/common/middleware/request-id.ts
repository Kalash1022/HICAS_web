import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export const REQUEST_ID_HEADER = 'x-request-id';

const SAFE_REQUEST_ID_PATTERN = /^[A-Za-z\d][A-Za-z\d._:-]{0,127}$/;

export interface RequestWithId extends IncomingMessage {
  requestId?: string;
}

export function isSafeRequestId(value: unknown): value is string {
  return typeof value === 'string' && SAFE_REQUEST_ID_PATTERN.test(value);
}

export function getOrCreateRequestId(request: RequestWithId, response?: ServerResponse): string {
  const existingId = request.requestId ?? request.id;
  const header = request.headers[REQUEST_ID_HEADER];
  const incomingId = Array.isArray(header) ? header[0] : header;
  const requestId = isSafeRequestId(existingId)
    ? existingId
    : isSafeRequestId(incomingId)
      ? incomingId
      : randomUUID();

  request.id = requestId;
  request.requestId = requestId;
  response?.setHeader('X-Request-Id', requestId);

  return requestId;
}
