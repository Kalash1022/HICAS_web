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
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { AddressesService } from './addresses.service';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';
import type { AddressView } from './addresses.types';

@ApiTags('Addresses')
@ApiBearerAuth('access-token')
@Controller('me/addresses')
export class AddressesController {
  constructor(private readonly addresses: AddressesService) {}

  @Get()
  @ApiOperation({ summary: 'List addresses owned by the current user' })
  list(@CurrentUser() actor: AuthenticatedUser): Promise<AddressView[]> {
    return this.addresses.list(actor);
  }

  @Post()
  @ApiOperation({ summary: 'Create an address for the current user' })
  @ApiResponse({ status: HttpStatus.CREATED })
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateAddressDto,
  ): Promise<AddressView> {
    return this.addresses.create({ actor, dto });
  }

  @Patch(':addressId')
  @ApiOperation({ summary: 'Update an address owned by the current user' })
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('addressId', new ParseUUIDPipe({ version: '4' })) addressId: string,
    @Body() dto: UpdateAddressDto,
  ): Promise<AddressView> {
    return this.addresses.update({ actor, addressId, dto });
  }

  @Delete(':addressId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete an address owned by the current user' })
  delete(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('addressId', new ParseUUIDPipe({ version: '4' })) addressId: string,
  ): Promise<{ deleted: true }> {
    return this.addresses.delete({ actor, addressId });
  }
}
