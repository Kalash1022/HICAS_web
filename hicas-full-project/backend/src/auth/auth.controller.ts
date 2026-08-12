import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiCookieAuth, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { Public } from '../common/decorators/public.decorator';
import { ApplicationException } from '../common/exceptions/application.exception';
import { REFRESH_TOKEN_COOKIE } from './auth.constants';
import { AuthService } from './auth.service';
import type { PublicAuthenticationResult } from './auth.types';
import { EmailDto } from './dto/email.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { TokenDto } from './dto/token.dto';
import { AuthenticationResponseService } from './services/authentication-response.service';
import { CookieOriginService } from './services/cookie-origin.service';
import { requestContextFromRequest } from './utilities/request-context';

const CLEAR_REFRESH_COOKIE_STATUSES = new Set<number>([
  HttpStatus.UNAUTHORIZED,
  HttpStatus.FORBIDDEN,
]);

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly cookieOrigins: CookieOriginService,
    private readonly authenticationResponses: AuthenticationResponseService,
  ) {}

  @Post('register')
  @Public()
  @ApiOperation({ summary: 'Register an email/password customer account' })
  @ApiResponse({ status: HttpStatus.CREATED })
  register(
    @Body() dto: RegisterDto,
    @Req() request: Request,
  ): Promise<{ userId: string; status: 'PENDING'; verificationRequired: true }> {
    return this.auth.register(dto, requestContextFromRequest(request));
  }

  @Post('verify-email')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Consume a single-use email verification token' })
  verifyEmail(@Body() dto: TokenDto): Promise<{ verified: true }> {
    return this.auth.verifyEmail(dto);
  }

  @Post('resend-verification')
  @Public()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Request another verification email' })
  @ApiResponse({
    status: HttpStatus.ACCEPTED,
    description: 'Always generic to prevent account discovery',
  })
  resendVerification(@Body() dto: EmailDto, @Req() request: Request): Promise<{ accepted: true }> {
    return this.auth.resendVerification(dto, requestContextFromRequest(request));
  }

  @Post('forgot-password')
  @Public()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Request a password reset email' })
  @ApiResponse({
    status: HttpStatus.ACCEPTED,
    description: 'Always generic to prevent account discovery',
  })
  forgotPassword(@Body() dto: EmailDto, @Req() request: Request): Promise<{ accepted: true }> {
    return this.auth.forgotPassword(dto, requestContextFromRequest(request));
  }

  @Post('reset-password')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Consume a reset token and replace the password' })
  resetPassword(@Body() dto: ResetPasswordDto, @Req() request: Request): Promise<{ reset: true }> {
    return this.auth.resetPassword(dto, requestContextFromRequest(request));
  }

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Authenticate with email and password' })
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
      'Cache-Control': {
        description: 'Prevents storage of authentication credentials.',
        schema: { type: 'string', example: 'no-store' },
      },
      Pragma: {
        description: 'Legacy cache prevention for authentication credentials.',
        schema: { type: 'string', example: 'no-cache' },
      },
      'Set-Cookie': {
        description:
          'Sets the HttpOnly refresh cookie when a full session is issued; absent for MFA enrollment or challenge responses.',
        schema: { type: 'string' },
      },
    },
  })
  async login(
    @Body() dto: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PublicAuthenticationResult> {
    this.cookieOrigins.assertTrusted(request);
    this.authenticationResponses.disableAuthenticationResponseCaching(response);
    const result = await this.auth.login(dto, requestContextFromRequest(request));
    return this.authenticationResponses.finishAuthentication(result, response);
  }

  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiCookieAuth(REFRESH_TOKEN_COOKIE)
  @ApiOperation({ summary: 'Rotate the current refresh token' })
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
      'Cache-Control': {
        description: 'Prevents storage of authentication credentials.',
        schema: { type: 'string', example: 'no-store' },
      },
      Pragma: {
        description: 'Legacy cache prevention for authentication credentials.',
        schema: { type: 'string', example: 'no-cache' },
      },
      'Set-Cookie': {
        description: 'Replaces the HttpOnly refresh cookie with the rotated token.',
        schema: { type: 'string' },
      },
    },
  })
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PublicAuthenticationResult> {
    this.cookieOrigins.assertTrusted(request);
    this.authenticationResponses.disableAuthenticationResponseCaching(response);

    try {
      const refreshToken = this.authenticationResponses.readRefreshToken(request);
      if (!refreshToken) {
        throw new ApplicationException(
          HttpStatus.UNAUTHORIZED,
          'AUTH_REFRESH_TOKEN_INVALID',
          'The refresh token is invalid or expired.',
        );
      }

      const result = await this.auth.refresh(refreshToken, requestContextFromRequest(request));
      return this.authenticationResponses.finishAuthentication(result, response);
    } catch (error) {
      if (error instanceof HttpException && CLEAR_REFRESH_COOKIE_STATUSES.has(error.getStatus())) {
        this.authenticationResponses.clearRefreshCookie(response);
      }
      throw error;
    }
  }

  @Post('logout')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiCookieAuth(REFRESH_TOKEN_COOKIE)
  @ApiOperation({ summary: 'Revoke the current session' })
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
      'Set-Cookie': {
        description: 'Clears the HttpOnly refresh cookie.',
        schema: { type: 'string' },
      },
    },
  })
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ loggedOut: true }> {
    this.cookieOrigins.assertTrusted(request);
    const result = await this.auth.logout(this.authenticationResponses.readRefreshToken(request));
    this.authenticationResponses.clearRefreshCookie(response);
    return result;
  }
}
