import { HttpStatus, Injectable } from '@nestjs/common';

import { ApplicationException } from '../common/exceptions/application.exception';
import { DatabaseService } from '../database/database.service';

export interface HealthStatus {
  status: 'ok';
  timestamp: string;
  checks?: {
    database: 'up';
  };
}

@Injectable()
export class HealthService {
  constructor(private readonly database: DatabaseService) {}

  live(): HealthStatus {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  async ready(): Promise<HealthStatus> {
    try {
      await this.database.ping();
    } catch {
      throw new ApplicationException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'SERVICE_NOT_READY',
        'Service is not ready',
        { database: 'down' },
      );
    }

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      checks: { database: 'up' },
    };
  }
}
