const HEX_ENCRYPTION_KEY_PATTERN = /^[a-f\d]{64}$/i;
const BASE64_ENCRYPTION_KEY_PATTERN = /^[A-Za-z\d+/]{43}=$/;
const BASE64URL_ENCRYPTION_KEY_PATTERN = /^[A-Za-z\d_-]{43}$/;

const ENCRYPTION_KEY_BYTES = 32;

/**
 * Decodes the application encryption-key format accepted by environment validation.
 * OAuth transaction data and MFA secrets must use distinct values.
 */
export function decodeEncryptionKey(value: string): Buffer {
  let decoded: Buffer;

  if (HEX_ENCRYPTION_KEY_PATTERN.test(value)) {
    decoded = Buffer.from(value, 'hex');
  } else if (BASE64_ENCRYPTION_KEY_PATTERN.test(value)) {
    decoded = Buffer.from(value, 'base64');
  } else if (BASE64URL_ENCRYPTION_KEY_PATTERN.test(value)) {
    decoded = Buffer.from(value, 'base64url');
  } else {
    throw new Error('Encryption key must be 32 bytes encoded as base64, base64url, or hex.');
  }

  if (decoded.byteLength !== ENCRYPTION_KEY_BYTES) {
    throw new Error(`Encryption key must decode to exactly ${ENCRYPTION_KEY_BYTES} bytes.`);
  }

  return decoded;
}
