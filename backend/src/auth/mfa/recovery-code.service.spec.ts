import { RecoveryCodeService } from './recovery-code.service';

describe(RecoveryCodeService.name, () => {
  let service: RecoveryCodeService;

  beforeEach(() => {
    service = new RecoveryCodeService();
  });

  it('generates exactly ten unique, human-readable 100-bit recovery codes', () => {
    const batch = service.generateBatch();

    expect(batch.codes).toHaveLength(10);
    expect(new Set(batch.codes).size).toBe(10);
    expect(batch.hashes).toHaveLength(10);
    expect(new Set(batch.hashes).size).toBe(10);

    for (const code of batch.codes) {
      expect(code).toMatch(/^[2-9A-HJ-NP-Z]{4}(?:-[2-9A-HJ-NP-Z]{4}){4}$/);
    }
    for (const hash of batch.hashes) {
      expect(hash).toMatch(/^[a-f\d]{64}$/);
    }
  });

  it('returns hashes that correspond to the generated plaintext codes', () => {
    const batch = service.generateBatch();

    expect(batch.codes.map((code) => service.hashCode(code))).toEqual(batch.hashes);
    expect(batch.hashes).not.toContain(batch.codes[0]);
  });

  it('canonicalizes case, whitespace, and separators before hashing', () => {
    const canonical = '2345-6789-ABCD-EFGH-JKLM';
    const looselyFormatted = ' 2345 6789-abcd-efgh-jklm ';

    expect(service.normalizeCode(looselyFormatted)).toBe('23456789ABCDEFGHJKLM');
    expect(service.hashCode(looselyFormatted)).toBe(service.hashCode(canonical));
  });

  it.each(['', 'too-short', 'OOOO-OOOO-OOOO-OOOO-OOOO', '2345-6789-ABCD-EFGH-JKL!'])(
    'rejects invalid recovery code %s',
    (code) => {
      expect(service.normalizeCode(code)).toBeNull();
      expect(service.hashCode(code)).toBeNull();
    },
  );
});
