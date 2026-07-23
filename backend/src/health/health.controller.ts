import { Controller, Get } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';

import { Public } from '../common/decorators/public.decorator';
import { HealthService, type HealthStatus } from './health.service';

@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get('live')
  @ApiOperation({ summary: 'Check whether the backend process is alive' })
  @ApiOkResponse({ description: 'The backend process is alive.' })
  live(): HealthStatus {
    return this.healthService.live();
  }

  @Get('ready')
  @ApiOperation({ summary: 'Check whether the backend and database are ready' })
  @ApiOkResponse({ description: 'The backend and database are ready.' })
  @ApiServiceUnavailableResponse({ description: 'A required dependency is unavailable.' })
  ready(): Promise<HealthStatus> {
    return this.healthService.ready();
  }
}
