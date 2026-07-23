/**
 * MFA setup currently accepts no body fields. Keeping a concrete DTO lets the
 * global whitelist reject unexpected input instead of silently ignoring it.
 */
export class MfaSetupDto {}
