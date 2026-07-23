import type { ServerResponse } from 'node:http';

import { getOrCreateRequestId, type RequestWithId } from './request-id';

describe('getOrCreateRequestId', () => {
  it('preserves a safe incoming request ID and writes the response header', () => {
    const request = {
      headers: { 'x-request-id': 'checkout-42' },
    } as unknown as RequestWithId;
    const setHeader = jest.fn();
    const response = { setHeader } as unknown as ServerResponse;

    expect(getOrCreateRequestId(request, response)).toBe('checkout-42');
    expect(request.requestId).toBe('checkout-42');
    expect(setHeader).toHaveBeenCalledWith('X-Request-Id', 'checkout-42');
  });

  it('replaces an unsafe incoming value', () => {
    const request = {
      headers: { 'x-request-id': 'line-one\nline-two' },
    } as unknown as RequestWithId;

    expect(getOrCreateRequestId(request)).toMatch(
      /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i,
    );
  });
});
