import * as superagent from "superagent";
import {RouterEvent} from "cassava";
import {Charge} from "./stripedtos/Charge";

export async function getScore(minfraudScoreParams: MinfraudScoreParams, minfraudConfigPromise: Promise<MinfraudConfig>): Promise<ScoreResult> {
    const minfraudConfig = await minfraudConfigPromise;
    if (minfraudConfig.doMinfraudChecks) {
        console.log(`minfraud params: ${JSON.stringify(minfraudScoreParams)}`);
        const auth = Buffer.from("129417:BFjCPBaRxHaQ").toString("base64");
        const resp = await superagent.post("https://minfraud.maxmind.com/minfraud/v2.0/score")
            .set("Authorization", `Basic ${auth}`)
            .send(minfraudScoreParams);
        console.log(`minfraud result: ${JSON.stringify(resp.body)}`);
        return {
            risk: resp.body.risk_score,
            ipRisk: resp.body.ip_address.risk
        };
    } else {
        console.log("Skipping minfraud check since config is set to skip.")
    }
}

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

export function getMinfraudParamsForGiftcardPurchase(params: GiftcardPurchaseFraudCheckParams): MinfraudScoreParams {
    let res: MinfraudScoreParams = {
        device: {ip_address: getOriginIpFromRequest(params.request)},
        event: {type: "purchase" /* this is an enum from minfraud*/, transaction_id: params.charge.id},
        account: {user_id: params.userId},
        email: {
            address: params.senderEmail, // .replace(/@.*/, "")
            domain: params.senderEmail.replace(/.*@/, "")
        },
        billing: {
            first_name: params.name ? params.name.split(' ').slice(0, -1).join(' ') : "",
            last_name: params.name ? params.name.split(' ').slice(-1).join(' ') : "",
            postal: params.charge.source.address_zip || ""
        },
        payment: {
            processor: "stripe",
            was_authorized: params.charge.captured
        },
        credit_card: {
            last_4_digits: params.charge.source.last4,
            token: "token-" + params.charge.source.fingerprint // token must be at least 19 chars
        },
        order: {
            amount: params.charge.amount / 100,
            currency: params.charge.currency.toUpperCase()
        }
    };
    if (params.charge.source.cvc_check == "pass") {
        res.credit_card.cvv_result = "Y"
    } else if (params.charge.source.cvc_check == "fail") {
        res.credit_card.cvv_result = "N"
    }
    return res
}

export interface GiftcardPurchaseFraudCheckParams {
    request: RouterEvent
    charge: Charge
    userId: string
    senderEmail: string
    name?: string
}


function getOriginIpFromRequest(request: RouterEvent): string {
    return request.headers["X-Forwarded-For"].match(/[^,]*/)[0];
}


interface Device {
    ip_address: string
}

interface Event {
    type: string // "purchase"
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
    processor: string // "stripe"
    was_authorized: boolean
}

interface CreditCard {
    last_4_digits: string;
    token: string; // source.fingerprint
    cvv_result?: string; // source.cvc_check
}

interface Order {
    amount: number; // charge.amount / 100
    currency: string;

}

export interface ScoreResult {
    risk: number
    ipRisk: number
}

export interface MinfraudConfig {
    userId: string
    licenseKey: string
    doMinfraudChecks: boolean
}