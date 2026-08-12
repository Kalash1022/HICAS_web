import { Injectable } from '@nestjs/common';

import { CategoriesRepository } from './categories.repository';
import type { PublicCategory } from './public-categories.types';

@Injectable()
export class PublicCategoriesService {
  constructor(private readonly repository: CategoriesRepository) {}

  list(): Promise<PublicCategory[]> {
    return this.repository.listPublic();
  }
}
