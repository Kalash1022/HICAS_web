import { ApplicationException } from '../../common/exceptions/application.exception';
import {
  AUTH_RATE_LIMIT_MAX_TRACKED_KEYS,
  AuthRateLimiterService,
} from './auth-rate-limiter.service';

describe(AuthRateLimiterService.name, () => {
  let limiter: AuthRateLimiterService;
  let now: number;

  beforeEach(() => {
    limiter = new AuthRateLimiterService();
    now = Date.parse('2026-01-01T00:00:00.000Z');
    jest.spyOn(Date, 'now').mockImplementation(() => now);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('limits password login by normalized account and IP', () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      limiter.consumeLogin('customer@example.com', '127.0.0.1');
    }

    expect(() => limiter.consumeLogin('customer@example.com', '127.0.0.1')).toThrow(
      ApplicationException,
    );
  });

  it('uses the stricter resend email limit without exposing account existence', () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      limiter.consumeResend('unknown@example.com', '127.0.0.1');
    }

    expect(() => limiter.consumeResend('unknown@example.com', '127.0.0.2')).toThrow(
      ApplicationException,
    );
  });

  it('allows requests again after the fixed window', () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      limiter.consumeLogin('customer@example.com', '127.0.0.1');
    }
    now += 15 * 60 * 1_000 + 1;

    expect(() => limiter.consumeLogin('customer@example.com', '127.0.0.1')).not.toThrow();
  });

  it('limits password reset before lookup by opaque token and IP', () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      limiter.consumeResetPasswordPreflight('reset-token-hash', `127.0.1.${attempt}`);
    }

    expect(() => limiter.consumeResetPasswordPreflight('reset-token-hash', '127.0.1.99')).toThrow(
      ApplicationException,
    );
  });

  it('uses a stable refresh family bucket across token rotations', () => {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      limiter.consumeRefreshFamily('family-id');
    }

    expect(() => limiter.consumeRefreshFamily('family-id')).toThrow(ApplicationException);
  });

  it.each([
    [
      'authorization URL',
      20,
      (service: AuthRateLimiterService) => service.consumeGoogleAuthorization('127.0.0.9'),
    ],
    [
      'callback',
      10,
      (service: AuthRateLimiterService) => service.consumeGoogleCallback('127.0.0.9'),
    ],
  ])('limits Google %s by IP after %i requests', (_operation, limit, consume) => {
    for (let attempt = 0; attempt < limit; attempt += 1) {
      consume(limiter);
    }

    expect(() => consume(limiter)).toThrow(ApplicationException);
  });

  it('limits MFA setup to five requests per user each hour', () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      limiter.consumeMfaSetup('staff-user-id');
    }

    expect(() => limiter.consumeMfaSetup('staff-user-id')).toThrow(ApplicationException);
    expect(() => limiter.consumeMfaSetup('another-staff-user-id')).not.toThrow();

    now += 60 * 60 * 1_000 + 1;
    expect(() => limiter.consumeMfaSetup('staff-user-id')).not.toThrow();
  });

  it('limits MFA enable attempts by enrollment-token hash', () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      limiter.consumeMfaEnable('enrollment-token-hash');
    }

    expect(() => limiter.consumeMfaEnable('enrollment-token-hash')).toThrow(ApplicationException);
    expect(() => limiter.consumeMfaEnable('another-enrollment-token-hash')).not.toThrow();

    now += 15 * 60 * 1_000 + 1;
    expect(() => limiter.consumeMfaEnable('enrollment-token-hash')).not.toThrow();
  });

  it('bounds attacker-controlled key cardinality', () => {
    for (let attempt = 0; attempt < 5_010; attempt += 1) {
      limiter.consumeLogin(`customer-${attempt}@example.com`, `192.0.2.${attempt}`);
    }

    const state = limiter as unknown as {
      attempts: Map<string, unknown>;
    };
    expect(state.attempts.size).toBeLessThanOrEqual(AUTH_RATE_LIMIT_MAX_TRACKED_KEYS);
  });
});
