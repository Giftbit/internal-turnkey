import {Charge} from "../../utils/stripedtos/Charge";
import {Refund} from "../../utils/stripedtos/Refund";
import {StripeCreateChargeParams} from "../../utils/stripedtos/StripeCreateChargeParams";
import {StripeUpdateChargeParams} from "../../utils/stripedtos/StripeUpdateChargeParams";
import {httpStatusCode} from "cassava";
import {GiftbitRestError} from "giftbit-cassava-routes/dist/GiftbitRestError";

export async function createCharge(params: StripeCreateChargeParams, lightrailStripeSecretKey: string, merchantStripeAccountId: string): Promise<Charge> {
    try {
        const lightrailStripe = require("stripe")(lightrailStripeSecretKey);
        params.description = "Gift Card";
        params.metadata = {info: "The gift card issued from this charge was issued with a userSuppliedId of the charge id."};
        console.log(`Creating charge ${JSON.stringify(params)}.`);
        return lightrailStripe.charges.create(params, {
            stripe_account: merchantStripeAccountId,
        });
    } catch (err) {
        switch (err.type) {
            case 'StripeCardError':
                throw new GiftbitRestError(httpStatusCode.clientError.BAD_REQUEST, "Failed to charge card in Stripe.", "ChargeFailed");
            case 'StripeInvalidRequestError':
                throw new GiftbitRestError(httpStatusCode.clientError.BAD_REQUEST, "The stripeCardToken was invalid.", "StripeInvalidRequestError");
            case 'RateLimitError':
                throw new GiftbitRestError(httpStatusCode.clientError.TOO_MANY_REQUESTS, `Service was rate limited by dependent service.`, "DependentServiceRateLimited");
            default:
                throw new Error(`An unexpected error occurred while attempting to charge card. error ${err}`);
        }
    }
}

export async function updateCharge(chargeId: string, params: StripeUpdateChargeParams, lightrailStripeSecretKey: string, merchantStripeAccountId: string): Promise<any> {
    const merchantStripe = require("stripe")(lightrailStripeSecretKey);
    console.log(`Updating charge ${JSON.stringify(params)}.`);
    return merchantStripe.charges.update(
        chargeId,
        params, {
            stripe_account: merchantStripeAccountId,
        }
    );
}

export async function createRefund(chargeId: string, lightrailStripeSecretKey: string, merchantStripeAccountId: string): Promise<Refund> {
    const lightrailStripe = require("stripe")(lightrailStripeSecretKey);
    console.log(`Creating refund for charge ${chargeId}.`);
    return lightrailStripe.refunds.create({
        charge: chargeId,
        metadata: {"explanation": "The Lightrail Gift Card could not be issued due to an unexpected error."}
    }, {
        stripe_account: merchantStripeAccountId
    });
}