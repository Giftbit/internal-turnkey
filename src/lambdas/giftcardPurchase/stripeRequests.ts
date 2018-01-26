import {Charge} from "../../utils/stripedtos/Charge";
import {Refund} from "../../utils/stripedtos/Refund";
import {StripeCreateChargeParams} from "../../utils/stripedtos/StripeCreateChargeParams";
import {StripeUpdateChargeParams} from "../../utils/stripedtos/StripeUpdateChargeParams";
import {httpStatusCode} from "cassava";
import {GiftbitRestError} from "giftbit-cassava-routes/dist/GiftbitRestError";

export async function createCharge(params: StripeCreateChargeParams, lightrailStripeSecretKey: string, merchantStripeAccountId: string): Promise<Charge> {
    const lightrailStripe = require("stripe")(lightrailStripeSecretKey);
    params.description = "Lightrail Gift Card charge.";
    console.log(`Creating charge ${JSON.stringify(params)}.`);
    let charge: Charge;
    try {
        charge = await lightrailStripe.charges.create(params, {
            stripe_account: merchantStripeAccountId,
        });
    } catch (err) {
        switch (err.type) {
            case "StripeCardError":
                throw new GiftbitRestError(httpStatusCode.clientError.BAD_REQUEST, "Failed to charge credit card..", "ChargeFailed");
            case "StripeInvalidRequestError":
                throw new GiftbitRestError(httpStatusCode.clientError.BAD_REQUEST, "The stripeCardToken was invalid.", "StripeInvalidRequestError");
            case "RateLimitError":
                throw new GiftbitRestError(httpStatusCode.clientError.TOO_MANY_REQUESTS, `Service was rate limited by dependent service.`, "DependentServiceRateLimited");
            default:
                throw new Error(`An unexpected error occurred while attempting to charge card. error ${err}`);
        }
    }
    console.log(`Created charge ${JSON.stringify(charge)}`);
    return charge;
}

export async function updateCharge(chargeId: string, params: StripeUpdateChargeParams, lightrailStripeSecretKey: string, merchantStripeAccountId: string): Promise<any> {
    const merchantStripe = require("stripe")(lightrailStripeSecretKey);
    console.log(`Updating charge ${JSON.stringify(params)}.`);
    const chargeUpdate = await merchantStripe.charges.update(
        chargeId,
        params, {
            stripe_account: merchantStripeAccountId,
        }
    );
    // todo make this a DTO.
    console.log(`Updated charge ${JSON.stringify(chargeUpdate)}.`);
    return chargeUpdate;
}

export async function createRefund(chargeId: string, lightrailStripeSecretKey: string, merchantStripeAccountId: string, reason?: string): Promise<Refund> {
    const lightrailStripe = require("stripe")(lightrailStripeSecretKey);
    console.log(`Creating refund for charge ${chargeId}.`);
    const refund = await lightrailStripe.refunds.create({
        charge: chargeId,
        metadata: {reason: reason || "not specified"} /* Doesn't show up in charge in stripe. Need to update charge so that it's obvious as to why it was refunded. */
    }, {
        stripe_account: merchantStripeAccountId
    });
    await updateCharge(chargeId, {
        description: reason
    }, lightrailStripeSecretKey, merchantStripeAccountId);
    console.log(JSON.stringify(refund));
    return refund;
}
