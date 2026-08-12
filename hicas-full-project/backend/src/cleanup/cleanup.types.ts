export interface DatabaseCleanupResult {
  oauthTransactions: number;
  verificationTokens: number;
  sessions: number;
  mfaChallenges: number;
  mfaEnrollmentGrants: number;
  pendingMfaSetups: number;
}

export interface OrphanImageCleanupResult {
  inspected: number;
  deleted: number;
  skipped: number;
}

export interface CleanupRunResult {
  database: DatabaseCleanupResult | null;
  orphanImages: OrphanImageCleanupResult | null;
}
