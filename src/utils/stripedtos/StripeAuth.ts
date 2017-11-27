export interface StripeAuth {

    token_type: "bearer";
    stripe_publishable_key: string;
    scope: "read_write" | "read_only";
    livemode: boolean;
    stripe_user_id: string;
    refresh_token: string;
    access_token: string;
}
