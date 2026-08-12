import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';

const RECOVERY_CODE_COUNT = 10;
const RECOVERY_CODE_SYMBOLS = 20;
const RECOVERY_CODE_GROUP_SIZE = 4;
const RECOVERY_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const NORMALIZED_RECOVERY_CODE_PATTERN = /^[2-9A-HJ-NP-Z]{20}$/;

export interface RecoveryCodeBatch {
  codes: string[];
  hashes: string[];
}

@Injectable()
export class RecoveryCodeService {
  generateBatch(): RecoveryCodeBatch {
    const normalizedCodes = new Set<string>();
    while (normalizedCodes.size < RECOVERY_CODE_COUNT) {
      normalizedCodes.add(this.generateNormalizedCode());
    }

    const normalized = [...normalizedCodes];
    return {
      codes: normalized.map((code) => this.formatCode(code)),
      hashes: normalized.map((code) => this.hashNormalizedCode(code)),
    };
  }

  normalizeCode(code: string): string | null {
    const normalized = code.trim().toUpperCase().replace(/[\s-]/g, '');
    return NORMALIZED_RECOVERY_CODE_PATTERN.test(normalized) ? normalized : null;
  }

  hashCode(code: string): string | null {
    const normalized = this.normalizeCode(code);
    return normalized === null ? null : this.hashNormalizedCode(normalized);
  }

  private generateNormalizedCode(): string {
    // Twenty five-bit symbols provide 100 bits of entropy per recovery code.
    const entropy = randomBytes(13);
    let accumulator = 0;
    let availableBits = 0;
    let result = '';

    for (const byte of entropy) {
      accumulator = (accumulator << 8) | byte;
      availableBits += 8;

      while (availableBits >= 5 && result.length < RECOVERY_CODE_SYMBOLS) {
        availableBits -= 5;
        result += RECOVERY_CODE_ALPHABET[(accumulator >>> availableBits) & 0x1f];
      }
    }

    return result;
  }

  private formatCode(normalized: string): string {
    const groups: string[] = [];
    for (let offset = 0; offset < normalized.length; offset += RECOVERY_CODE_GROUP_SIZE) {
      groups.push(normalized.slice(offset, offset + RECOVERY_CODE_GROUP_SIZE));
    }
    return groups.join('-');
  }

  private hashNormalizedCode(normalized: string): string {
    return createHash('sha256').update(normalized, 'utf8').digest('hex');
  }
}
