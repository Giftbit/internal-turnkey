/**
 * Stripe configuration values stored in secure config.
 */
export interface StripeConfig {
    email: string;
    test: StripeModeConfig;
    live: StripeModeConfig;
}

/**
 * Configuration particular to a mode in Stripe (live or test).
 */
export interface StripeModeConfig {
    clientId: string;
    secretKey: string;
    publishableKey: string;
}
