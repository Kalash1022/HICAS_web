import { HttpException, type HttpStatus } from '@nestjs/common';

export interface ApplicationErrorResponse {
  code: string;
  message: string;
  details?: unknown;
}

export class ApplicationException extends HttpException {
  constructor(status: HttpStatus, code: string, message: string, details?: unknown) {
    const response: ApplicationErrorResponse = {
      code,
      message,
      ...(details === undefined ? {} : { details }),
    };

    super(response, status);
  }
}
