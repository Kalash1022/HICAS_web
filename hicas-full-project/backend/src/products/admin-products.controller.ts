import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import type { Request } from 'express';
import { memoryStorage } from 'multer';

import { requestContextFromRequest } from '../auth/utilities/request-context';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { PaginatedResult } from '../common/interceptors/response-envelope.interceptor';
import { getOrCreateRequestId } from '../common/middleware/request-id';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { CreateProductDto } from './dto/create-product.dto';
import { ListProductsQueryDto } from './dto/list-products-query.dto';
import { UploadProductImageDto } from './dto/upload-product-image.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductImagesService } from './product-images.service';
import { ProductsService } from './products.service';
import type {
  AdminProductDetail,
  AdminProductSummary,
  ProductImageSummary,
} from './products.types';
import { MAX_PRODUCT_IMAGE_BYTES } from '../uploads/image-processing.service';

@ApiTags('Administration - Products')
@ApiBearerAuth('access-token')
@Roles(UserRole.STAFF, UserRole.ADMIN)
@Controller('admin/products')
export class AdminProductsController {
  constructor(
    private readonly products: ProductsService,
    private readonly images: ProductImagesService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List products for catalog administration' })
  list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListProductsQueryDto,
  ): Promise<PaginatedResult<AdminProductSummary>> {
    return this.products.list(actor, query);
  }

  @Post()
  @ApiOperation({ summary: 'Create a draft product with zero inventory' })
  @ApiResponse({ status: HttpStatus.CREATED })
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateProductDto,
    @Req() request: Request,
  ): Promise<AdminProductDetail> {
    return this.products.create({
      actor,
      dto,
      request: requestContextFromRequest(request),
      requestId: getOrCreateRequestId(request),
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an administrative product detail' })
  get(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) productId: string,
  ): Promise<AdminProductDetail> {
    return this.products.get(actor, productId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a product or transition it to ACTIVE' })
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) productId: string,
    @Body() dto: UpdateProductDto,
    @Req() request: Request,
  ): Promise<AdminProductDetail> {
    return this.products.update({
      actor,
      productId,
      dto,
      request: requestContextFromRequest(request),
      requestId: getOrCreateRequestId(request),
    });
  }

  @Post(':id/images')
  @UseInterceptors(
    FileInterceptor('image', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_PRODUCT_IMAGE_BYTES, files: 1 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload and attach an optimized product image' })
  uploadImage(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) productId: string,
    @Body() dto: UploadProductImageDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() request: Request,
  ): Promise<ProductImageSummary> {
    return this.images.upload({
      actor,
      productId,
      dto,
      file,
      request: requestContextFromRequest(request),
      requestId: getOrCreateRequestId(request),
    });
  }

  @Delete(':id/images/:imageId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a product image' })
  deleteImage(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) productId: string,
    @Param('imageId', new ParseUUIDPipe({ version: '4' })) imageId: string,
    @Req() request: Request,
  ): Promise<{ deleted: true }> {
    return this.images.delete({
      actor,
      productId,
      imageId,
      request: requestContextFromRequest(request),
      requestId: getOrCreateRequestId(request),
    });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft-delete a product' })
  delete(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) productId: string,
    @Req() request: Request,
  ): Promise<{ deleted: true }> {
    return this.products.softDelete({
      actor,
      productId,
      request: requestContextFromRequest(request),
      requestId: getOrCreateRequestId(request),
    });
  }
}
