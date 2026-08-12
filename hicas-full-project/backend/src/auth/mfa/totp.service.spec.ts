import { TotpService } from './totp.service';

const RFC_SHA1_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe(TotpService.name, () => {
  let service: TotpService;

  beforeEach(() => {
    service = new TotpService();
  });

  it('generates canonical base32 secrets containing 20 random bytes', () => {
    const first = service.generateSecret();
    const second = service.generateSecret();

    expect(first).toMatch(/^[A-Z2-7]{32}$/);
    expect(second).toMatch(/^[A-Z2-7]{32}$/);
    expect(second).not.toBe(first);
  });

  it('matches the six-digit form of the RFC 6238 SHA-1 test vector', () => {
    const at = new Date(59_000);

    expect(service.generateCode(RFC_SHA1_SECRET, at)).toBe('287082');
    expect(service.verifyCode(RFC_SHA1_SECRET, '287082', at)).toBe(1n);
  });

  it('accepts only the adjacent time steps and returns the matched bigint step', () => {
    const previousStepCode = service.generateCode(RFC_SHA1_SECRET, new Date(59_000));

    expect(service.verifyCode(RFC_SHA1_SECRET, previousStepCode, new Date(89_000))).toBe(1n);
    expect(service.verifyCode(RFC_SHA1_SECRET, previousStepCode, new Date(119_000))).toBeNull();
  });

  it.each(['12345', '1234567', '12a456', ' 123456'])('rejects malformed OTP code %s', (code) => {
    expect(service.verifyCode(RFC_SHA1_SECRET, code, new Date(59_000))).toBeNull();
  });

  it('rejects malformed secrets without leaking decoder errors during verification', () => {
    expect(service.verifyCode('not-a-secret', '123456', new Date(59_000))).toBeNull();
    expect(() => service.generateCode('not-a-secret', new Date(59_000))).toThrow();
  });

  it('builds an encoded standards-compatible otpauth URI', () => {
    const uri = new URL(
      service.createOtpAuthUri(RFC_SHA1_SECRET, 'staff@example.com', 'HICAS Commerce'),
    );

    expect(uri.protocol).toBe('otpauth:');
    expect(uri.hostname).toBe('totp');
    expect(decodeURIComponent(uri.pathname)).toBe('/HICAS Commerce:staff@example.com');
    expect(uri.searchParams.get('secret')).toBe(RFC_SHA1_SECRET);
    expect(uri.searchParams.get('issuer')).toBe('HICAS Commerce');
    expect(uri.searchParams.get('algorithm')).toBe('SHA1');
    expect(uri.searchParams.get('digits')).toBe('6');
    expect(uri.searchParams.get('period')).toBe('30');
  });
});
