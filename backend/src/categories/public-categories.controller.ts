import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../common/decorators/public.decorator';
import { PublicCategoriesService } from './public-categories.service';
import type { PublicCategory } from './public-categories.types';

@ApiTags('Storefront - Categories')
@Public()
@Controller('categories')
export class PublicCategoriesController {
  constructor(private readonly categories: PublicCategoriesService) {}

  @Get()
  @ApiOperation({ summary: 'List active categories visible in the storefront' })
  list(): Promise<PublicCategory[]> {
    return this.categories.list();
  }
}
