import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { Public } from '../../common/decorators/public.decorator';
import { ApplicationException } from '../../common/exceptions/application.exception';
import type { PublicAuthenticationResult } from '../auth.types';
import { GoogleCallbackDto } from '../dto/google-callback.dto';
import { AuthenticationResponseService } from '../services/authentication-response.service';
import { CookieOriginService } from '../services/cookie-origin.service';
import { constantTimeEqual } from '../utilities/auth-crypto';
import { requestContextFromRequest } from '../utilities/request-context';
import { GoogleAuthService } from './google-auth.service';

const AUTHENTICATION_RESPONSE_HEADERS = {
  'Cache-Control': {
    description: 'Prevents storage of OAuth credentials.',
    schema: { type: 'string', example: 'no-store' },
  },
  Pragma: {
    description: 'Legacy cache prevention for OAuth credentials.',
    schema: { type: 'string', example: 'no-cache' },
  },
};

@ApiTags('Authentication')
@Controller('auth/google')
export class GoogleAuthController {
  constructor(
    private readonly google: GoogleAuthService,
    private readonly cookieOrigins: CookieOriginService,
    private readonly authenticationResponses: AuthenticationResponseService,
  ) {}

  @Get('url')
  @Public()
  @ApiOperation({ summary: 'Create a state-bound Google OIDC authorization URL' })
  @ApiHeader({
    name: 'Origin',
    required: false,
    description: 'Exact allowed frontend origin. Required unless Referer supplies it.',
    schema: { type: 'string', format: 'uri' },
  })
  @ApiHeader({
    name: 'Referer',
    required: false,
    description: 'Fallback URL whose origin must be allowed when Origin is absent.',
    schema: { type: 'string', format: 'uri' },
  })
  @ApiResponse({
    status: HttpStatus.OK,
    headers: {
      ...AUTHENTICATION_RESPONSE_HEADERS,
      'Set-Cookie': {
        description: 'Sets a short-lived HttpOnly browser-binding cookie for the OAuth state.',
        schema: { type: 'string' },
      },
    },
  })
  async authorizationUrl(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ authorizationUrl: string; expiresIn: number }> {
    this.cookieOrigins.assertTrusted(request);
    this.authenticationResponses.disableAuthenticationResponseCaching(response);
    const result = await this.google.createAuthorizationUrl(requestContextFromRequest(request));
    this.authenticationResponses.setGoogleStateCookie(response, result.browserState);

    return {
      authorizationUrl: result.authorizationUrl,
      expiresIn: result.expiresIn,
    };
  }

  @Post('callback')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange and verify a single-use Google authorization code' })
  @ApiHeader({
    name: 'Origin',
    required: false,
    description: 'Exact allowed frontend origin. Required unless Referer supplies it.',
    schema: { type: 'string', format: 'uri' },
  })
  @ApiHeader({
    name: 'Referer',
    required: false,
    description: 'Fallback URL whose origin must be allowed when Origin is absent.',
    schema: { type: 'string', format: 'uri' },
  })
  @ApiResponse({
    status: HttpStatus.OK,
    headers: {
      ...AUTHENTICATION_RESPONSE_HEADERS,
      'Set-Cookie': {
        description:
          'Clears the OAuth state cookie and sets the refresh cookie only when a full session is issued.',
        schema: { type: 'string' },
      },
    },
  })
  async callback(
    @Body() dto: GoogleCallbackDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PublicAuthenticationResult> {
    this.cookieOrigins.assertTrusted(request);
    this.authenticationResponses.disableAuthenticationResponseCaching(response);

    try {
      const browserState = this.authenticationResponses.readGoogleStateCookie(request);
      if (!browserState || !constantTimeEqual(browserState, dto.state)) {
        throw new ApplicationException(
          HttpStatus.BAD_REQUEST,
          'OAUTH_STATE_COOKIE_MISMATCH',
          'This Google sign-in attempt does not belong to this browser. Start again.',
        );
      }

      const result = await this.google.callback(
        dto.code,
        dto.state,
        requestContextFromRequest(request),
      );
      return this.authenticationResponses.finishAuthentication(result, response);
    } finally {
      this.authenticationResponses.clearGoogleStateCookie(response);
    }
  }
}
