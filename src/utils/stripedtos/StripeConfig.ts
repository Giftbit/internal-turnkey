/**
 * Stripe configuration values stored in secure config.
 */
export interface StripeConfig {
    email: string;
    test: StripeEnvConfig;
    live: StripeEnvConfig;
}

export interface StripeEnvConfig {
    clientId: string;
    secretKey: string;
    publishableKey: string;
}
