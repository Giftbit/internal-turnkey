export interface StripeCreateChargeParams {
    amount: number;
    currency: string;
    description?: string;
    metadata?: any;
    receipt_email: string;
    source: string;
    customer?: string;
}
