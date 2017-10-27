export interface StripeAccount {
    id: string;
    object: string;
    business_name: string;
    business_url: string;
    charges_enabled: boolean;
    country: string;
    default_currency: string;
    details_submitted: boolean;
    display_name: string;
    email: string;
    metadata: object;
    statement_descriptor: string;
    support_email: string;
    support_phone: string;
    timezone: string;
    type: "standard" | "express" | "custom";
}
