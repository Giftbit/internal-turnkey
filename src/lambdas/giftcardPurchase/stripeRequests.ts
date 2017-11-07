import {GiftcardPurchaseParams} from "./GiftcardPurchaseParams";
import {Charge} from "./Charge";
import {Refund} from "./Refund";

export async function createCharge(requestParams: GiftcardPurchaseParams, currency: string, lightrailStripeSecretKey: string, merchantStripeAccountId: string): Promise<Charge> {
    const lightrailStripe = require("stripe")(lightrailStripeSecretKey);
    return lightrailStripe.charges.create({
        amount: requestParams.initialValue,
        currency: currency,
        description: "Gift Card.",
        source: requestParams.stripeCardToken,
        receipt_email: requestParams.senderEmail,
        metadata: {
            info: "The gift card issued from this charge was issued with a userSuppliedId of the charge id."
        }
    }, {
        stripe_account: merchantStripeAccountId,
    });
}

export async function updateCharge(chargeId: string, params: any, lightrailStripeSecretKey: string, merchantStripeAccountId: string): Promise<any> {
    const merchantStripe = require("stripe")(lightrailStripeSecretKey);
    return merchantStripe.charges.update(
        chargeId,
        params, {
            stripe_account: merchantStripeAccountId,
        }
    );
}

export async function createRefund(charge: any, lightrailStripeSecretKey: string, merchantStripeAccountId: string): Promise<Refund> {
    const lightrailStripe = require("stripe")(lightrailStripeSecretKey);
    return lightrailStripe.refunds.create({
        charge: charge.id,
        metadata: {"explanation": "The Lightrail Gift Card could not be issued due to technical reasons."}
    }, {
        stripe_account: merchantStripeAccountId
    });
}