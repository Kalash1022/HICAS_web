import type { Request } from 'express';

import type { RequestContext } from '../auth.types';

export function requestContextFromRequest(request: Request): RequestContext {
  const userAgent = request.get('user-agent');
  return {
    ipAddress: request.ip || request.socket.remoteAddress,
    ...(userAgent ? { userAgent: userAgent.slice(0, 512) } : {}),
  };
}
