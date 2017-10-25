export interface StripeAuthResponse {
    /**
     * eg: "bearer"
     */
    token_type: string;

    stripe_publishable_key: string;

    /**
     * eg: "read_write"
     */
    scope: string;

    livemode: boolean;

    stripe_user_id: string;

    refresh_token: string;

    access_token: string;
}
