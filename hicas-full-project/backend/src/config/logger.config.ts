import type { ConfigService } from '@nestjs/config';
import type { Params } from 'nestjs-pino';
import { stdTimeFunctions } from 'pino';

import { getOrCreateRequestId } from '../common/middleware/request-id';

const MFA_ENROLLMENT_SECRET_FIELDS = [
  'recoveryCodes',
  'manualKey',
  'otpauthUri',
  'qrCodeDataUrl',
  'secretEncrypted',
  'recoveryCodeHashes',
] as const;
const MFA_ENROLLMENT_SECRET_PATHS = MFA_ENROLLMENT_SECRET_FIELDS.flatMap((field) => [
  field,
  `*.${field}`,
  `*.*.${field}`,
  `*.*.*.${field}`,
]);

const REDACTED_LOG_PATHS = [
  'req.headers',
  'res.headers',
  'request.headers',
  'response.headers',
  'body',
  'req.body',
  'request.body',
  'authorization',
  'cookie',
  'password',
  'passwordHash',
  'accessToken',
  'refreshToken',
  'enrollmentToken',
  'mfaToken',
  'googleCode',
  'idToken',
  'otp',
  'totpSecret',
  'mfaSecret',
  'recoveryCode',
  '*.authorization',
  '*.cookie',
  '*.password',
  '*.passwordHash',
  '*.accessToken',
  '*.refreshToken',
  '*.enrollmentToken',
  '*.mfaToken',
  '*.googleCode',
  '*.idToken',
  '*.otp',
  '*.totpSecret',
  '*.mfaSecret',
  '*.recoveryCode',
  ...MFA_ENROLLMENT_SECRET_PATHS,
];

interface SerializedRequest {
  id?: string | number;
  method?: string;
  url?: string;
  remoteAddress?: string;
}

interface SerializedResponse {
  statusCode?: number;
}

function serializeRequest(request: SerializedRequest): Record<string, unknown> {
  return {
    id: request.id,
    method: request.method,
    path: request.url,
    remoteAddress: request.remoteAddress,
  };
}

function serializeResponse(response: SerializedResponse): Record<string, unknown> {
  return { statusCode: response.statusCode };
}

function serializeError(error: { type?: string }): Record<string, unknown> {
  return { type: error.type ?? 'Error' };
}

export function createLoggerParams(config: ConfigService): Params {
  return {
    pinoHttp: {
      level: config.get<string>('LOG_LEVEL', 'info'),
      timestamp: stdTimeFunctions.isoTime,
      quietReqLogger: true,
      redact: {
        paths: REDACTED_LOG_PATHS,
        remove: true,
      },
      genReqId: (request, response) => getOrCreateRequestId(request, response),
      serializers: {
        req: serializeRequest,
        res: serializeResponse,
        err: serializeError,
      },
      customLogLevel: (_request, response, error) => {
        if (error || response.statusCode >= 500) {
          return 'error';
        }

        if (response.statusCode >= 400) {
          return 'warn';
        }

        return 'info';
      },
    },
  };
}
