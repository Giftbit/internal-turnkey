export interface MinfraudScoreParams {
    device: Device
    event: Event
    account: Account
    email: Email
    billing: Billing
    payment: Payment
    credit_card: CreditCard
    order: Order
}

interface Device {
    ip_address: string
}

interface Event {
    type: string
    transaction_id: string
}

interface Account {
    user_id: string
}

interface Email {
    address: string
    domain: string
}

interface Billing {
    first_name: string
    last_name: string
    postal: string
}

interface Payment {
    processor: string
    was_authorized: boolean
}

interface CreditCard {
    last_4_digits: string;
    token: string;
    cvv_result?: string;
}

interface Order {
    amount: number;
    currency: string;
}