import {Charge} from "./Charge";
import {Refund} from "./Refund";
import {StripeCreateChargeParams} from "./StripeCreateChargeParams";
import {StripeUpdateChargeParams} from "./StripeUpdateChargeParams";

export async function createCharge(params: StripeCreateChargeParams, lightrailStripeSecretKey: string, merchantStripeAccountId: string): Promise<Charge> {
    const lightrailStripe = require("stripe")(lightrailStripeSecretKey);
    params.description = "Gift Card";
    params.metadata = {info: "The gift card issued from this charge was issued with a userSuppliedId of the charge id."};
    return lightrailStripe.charges.create(params, {
        stripe_account: merchantStripeAccountId,
    });
}

export async function updateCharge(chargeId: string, params: StripeUpdateChargeParams, lightrailStripeSecretKey: string, merchantStripeAccountId: string): Promise<any> {
    const merchantStripe = require("stripe")(lightrailStripeSecretKey);
    return merchantStripe.charges.update(
        chargeId,
        params, {
            stripe_account: merchantStripeAccountId,
        }
    );
}

export async function createRefund(chargeId: string, lightrailStripeSecretKey: string, merchantStripeAccountId: string): Promise<Refund> {
    const lightrailStripe = require("stripe")(lightrailStripeSecretKey);
    return lightrailStripe.refunds.create({
        charge: chargeId,
        metadata: {"explanation": "The Lightrail Gift Card could not be issued due to an unexpected error."}
    }, {
        stripe_account: merchantStripeAccountId
    });
}