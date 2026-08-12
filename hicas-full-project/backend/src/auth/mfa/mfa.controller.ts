import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { Public } from '../../common/decorators/public.decorator';
import type { PublicSessionAuthenticationResult } from '../auth.types';
import { AuthenticationResponseService } from '../services/authentication-response.service';
import { CookieOriginService } from '../services/cookie-origin.service';
import { requestContextFromRequest } from '../utilities/request-context';
import { extractMfaEnrollmentBearerToken } from './bearer-token';
import { EnableMfaDto } from './dto/enable-mfa.dto';
import { MfaSetupDto } from './dto/mfa-setup.dto';
import { VerifyMfaDto } from './dto/verify-mfa.dto';
import { MfaService, type MfaSetupResult } from './mfa.service';

interface PublicMfaEnableResult extends PublicSessionAuthenticationResult {
  recoveryCodes: string[];
}

@ApiTags('Authentication - MFA')
@Controller('auth/mfa')
export class MfaController {
  constructor(
    private readonly mfa: MfaService,
    private readonly cookieOrigins: CookieOriginService,
    private readonly authenticationResponses: AuthenticationResponseService,
  ) {}

  @Post('setup')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('mfa-enrollment-token')
  @ApiOperation({ summary: 'Create a pending Staff/Admin TOTP enrollment' })
  @ApiHeader({
    name: 'Origin',
    required: false,
    description: 'Exact allowed frontend origin. Required unless Referer supplies it.',
    schema: { type: 'string', format: 'uri' },
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'Returns a QR data URL and manual key once' })
  async setup(
    @Body() dto: MfaSetupDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<MfaSetupResult> {
    void dto;
    this.prepareSensitiveResponse(request, response);
    return this.mfa.setup(
      extractMfaEnrollmentBearerToken(request.headers.authorization),
      requestContextFromRequest(request),
    );
  }

  @Post('enable')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('mfa-enrollment-token')
  @ApiOperation({ summary: 'Verify the first TOTP code and complete MFA enrollment' })
  @ApiHeader({
    name: 'Origin',
    required: false,
    description: 'Exact allowed frontend origin. Required unless Referer supplies it.',
    schema: { type: 'string', format: 'uri' },
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Creates the full session and returns ten recovery codes once',
  })
  async enable(
    @Body() dto: EnableMfaDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PublicMfaEnableResult> {
    this.prepareSensitiveResponse(request, response);
    const result = await this.mfa.enable(
      extractMfaEnrollmentBearerToken(request.headers.authorization),
      dto,
      requestContextFromRequest(request),
    );
    const session = this.authenticationResponses.finishSessionAuthentication(
      result.session,
      response,
    );

    return {
      ...session,
      recoveryCodes: result.recoveryCodes,
    };
  }

  @Post('verify')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Complete a Staff/Admin login MFA challenge' })
  @ApiHeader({
    name: 'Origin',
    required: false,
    description: 'Exact allowed frontend origin. Required unless Referer supplies it.',
    schema: { type: 'string', format: 'uri' },
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Consumes the challenge and creates the full application session',
  })
  async verify(
    @Body() dto: VerifyMfaDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PublicSessionAuthenticationResult> {
    this.prepareSensitiveResponse(request, response);
    const session = await this.mfa.verify(dto, requestContextFromRequest(request));
    return this.authenticationResponses.finishSessionAuthentication(session, response);
  }

  private prepareSensitiveResponse(request: Request, response: Response): void {
    this.cookieOrigins.assertTrusted(request);
    this.authenticationResponses.disableAuthenticationResponseCaching(response);
  }
}
