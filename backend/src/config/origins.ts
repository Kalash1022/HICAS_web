export function parseAllowedOrigins(value: string): string[] {
  return value.split(',').map((origin) => origin.trim());
}
