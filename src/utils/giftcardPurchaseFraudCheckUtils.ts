import {MinfraudScoreParams} from "./minfraud/MinfraudScoreParams";
import {RouterEvent} from "cassava";
import {Charge} from "./stripedtos/Charge";

export function getMinfraudParamsForGiftcardPurchase(params: GiftcardPurchaseFraudCheckParams): MinfraudScoreParams {
    let res: MinfraudScoreParams = {
        device: {ip_address: getOriginIpFromRequest(params.request)},
        event: {type: "purchase" /* this is an enum from minfraud*/, transaction_id: params.charge.id},
        account: {user_id: params.userId},
        email: {
            address: params.recipientEmail, // .replace(/@.*/, "")
            domain: params.recipientEmail.replace(/.*@/, "")
        },
        billing: {
            first_name: params.name ? params.name.split(" ").slice(0, -1).join(" ") : "",
            last_name: params.name ? params.name.split(" ").slice(-1).join(" ") : "",
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
    if (params.charge.source.cvc_check === "pass") {
        res.credit_card.cvv_result = "Y";
    } else if (params.charge.source.cvc_check === "fail") {
        res.credit_card.cvv_result = "N";
    }
    return res;
}

export interface GiftcardPurchaseFraudCheckParams {
    request: RouterEvent;
    charge: Charge;
    userId: string;
    recipientEmail: string;
    name?: string;
}

function getOriginIpFromRequest(request: RouterEvent): string {
    return request.headers["X-Forwarded-For"].match(/[^,]*/)[0];
}
