import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { memoryStorage } from 'multer';

import { requestContextFromRequest } from '../auth/utilities/request-context';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { MAX_IMAGE_UPLOAD_BYTES } from '../uploads/image-processing.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UsersService } from './users.service';
import type { ProfileView } from './users.types';

@ApiTags('Profile')
@ApiBearerAuth('access-token')
@Controller('me')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @ApiOperation({ summary: 'Get the current authenticated user profile' })
  getProfile(@CurrentUser() actor: AuthenticatedUser): Promise<ProfileView> {
    return this.users.getProfile(actor);
  }

  @Patch()
  @ApiOperation({ summary: 'Update editable fields on the current user profile' })
  updateProfile(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: UpdateProfileDto,
  ): Promise<ProfileView> {
    return this.users.updateProfile({ actor, dto });
  }

  @Post('avatar')
  @UseInterceptors(
    FileInterceptor('image', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_IMAGE_UPLOAD_BYTES, files: 1 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload an optimized avatar for the current user' })
  @ApiResponse({ status: HttpStatus.CREATED })
  uploadAvatar(
    @CurrentUser() actor: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() request: Request,
  ): Promise<ProfileView> {
    return this.users.uploadAvatar({
      actor,
      file,
      request: requestContextFromRequest(request),
    });
  }
}
