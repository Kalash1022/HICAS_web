export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const MONEY_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;

export function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export function normalizeSlug(value: unknown): unknown {
  return typeof value === 'string' ? value.trim().toLowerCase() : value;
}

export function normalizeMoney(value: unknown): unknown {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return typeof value === 'string' ? value.trim() : value;
}
