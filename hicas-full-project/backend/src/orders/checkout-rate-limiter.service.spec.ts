import {
  CHECKOUT_RATE_LIMIT_MAX_TRACKED_KEYS,
  CheckoutRateLimiterService,
} from './checkout-rate-limiter.service';

describe(CheckoutRateLimiterService.name, () => {
  let limiter: CheckoutRateLimiterService;
  let now: number;

  beforeEach(() => {
    limiter = new CheckoutRateLimiterService();
    now = Date.parse('2026-08-03T00:00:00.000Z');
    jest.spyOn(Date, 'now').mockImplementation(() => now);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('limits checkout attempts by both current user and source IP', () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      limiter.consume('user-a', '127.0.0.1');
    }

    expect(() => limiter.consume('user-a', '127.0.0.2')).toThrow('Too many checkout attempts');
    expect(() => limiter.consume('user-b', '127.0.0.1')).toThrow('Too many checkout attempts');
  });

  it('allows checkout attempts after the ten minute window expires', () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      limiter.consume('user-a', '127.0.0.1');
    }
    now += 10 * 60 * 1_000 + 1;

    expect(() => limiter.consume('user-a', '127.0.0.1')).not.toThrow();
  });

  it('bounds in-memory buckets created from checkout source data', () => {
    for (let attempt = 0; attempt < 5_010; attempt += 1) {
      limiter.consume(`user-${attempt}`, `192.0.2.${attempt}`);
    }

    const state = limiter as unknown as { attempts: Map<string, unknown> };
    expect(state.attempts.size).toBeLessThanOrEqual(CHECKOUT_RATE_LIMIT_MAX_TRACKED_KEYS);
  });
});
