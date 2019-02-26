import * as superagent from "superagent";
import * as giftbitRoutes from "giftbit-cassava-routes";
import {httpStatusCode, RestError} from "cassava";
import {StripeAccount} from "./stripedtos/StripeAccount";
import {StripeConfig, StripeModeConfig} from "./stripedtos/StripeConfig";
import {StripeAuth} from "./stripedtos/StripeAuth";
import {StripeAuthErrorResponse} from "./stripedtos/StripeAuthErrorResponse";
import {GiftbitRestError} from "giftbit-cassava-routes/dist/GiftbitRestError";
import {StripeUpdateChargeParams} from "./stripedtos/StripeUpdateChargeParams";
import {Charge} from "./stripedtos/Charge";
import {Refund} from "./stripedtos/Refund";
import {StripeCreateChargeParams} from "./stripedtos/StripeCreateChargeParams";

const stripeConfigPromise = giftbitRoutes.secureConfig.fetchFromS3ByEnvVar<StripeConfig>("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_STRIPE");

/**
 * Get Stripe credentials for test or live mode.  Test mode credentials allow
 * dummy credit cards and skip through stripe connect.
 * @param test whether to use test account credentials or live credentials
 */
export async function getStripeConfig(test: boolean): Promise<StripeModeConfig> {
    const stripeConfig = await stripeConfigPromise;
    if (!stripeConfig.live && !stripeConfig.test) {
        // TEMP this is a short term measure to be able to use new code with old config files
        return stripeConfig as any;
    }
    return test ? stripeConfig.test : stripeConfig.live;
}

export async function fetchStripeAuth(authorizationCode: string, test: boolean): Promise<StripeAuth> {
    const stripeConfig = await getStripeConfig(test);
    const resp = await superagent.post("https://connect.stripe.com/oauth/token")
        .field({
            client_secret: stripeConfig.secretKey,
            code: authorizationCode,
            grant_type: "authorization_code"
        })
        .ok(() => true);

    if (resp.ok) {
        const stripeAuthResponse: StripeAuth = resp.body;
        if (!stripeAuthResponse.token_type
            || !stripeAuthResponse.stripe_publishable_key
            || !stripeAuthResponse.scope
            || !stripeAuthResponse.stripe_user_id
            || !stripeAuthResponse.refresh_token
            || !stripeAuthResponse.access_token) {
            const msg = "POSTing to https://connect.stripe.com/oauth/token generated a 200 response but the body does not match the expected output.";
            console.error(msg, {
                ...resp.body,
                refresh_token: stripeAuthResponse.refresh_token ? "***redacted***" : "!!!missing!!!",
                access_token: stripeAuthResponse.access_token ? "***redacted***" : "!!!missing!!!",
            });
            throw new Error(msg);
        }
        return stripeAuthResponse;
    }

    if ((resp.body as StripeAuthErrorResponse).error && (resp.body as StripeAuthErrorResponse).error_description) {
        console.error(`Unable to complete Stripe authorization.`, resp.text);
        throw new RestError(httpStatusCode.clientError.BAD_REQUEST, resp.body.error_description);
    }

    console.error("Unexpected Stripe authorization error.", resp.status, resp.text);
    throw new Error("Unexpected Stripe authorization error.");
}

export async function revokeStripeAuth(stripeAuth: StripeAuth, test: boolean): Promise<void> {
    const stripeConfig = await getStripeConfig(test);
    await superagent.post(`https://${stripeConfig.secretKey}:@connect.stripe.com/oauth/deauthorize`)
        .field({
            client_id: stripeConfig.clientId,
            stripe_user_id: stripeAuth.stripe_user_id
        })
        .ok(resp => resp.status < 400 || resp.status === 401);
}

export async function fetchStripeAccount(stripeAuth: StripeAuth, test: boolean): Promise<StripeAccount> {
    const stripeConfig = await getStripeConfig(test);
    const resp = await superagent.get(`https://${stripeConfig.secretKey}:@api.stripe.com/v1/accounts/${stripeAuth.stripe_user_id}`)
        .set("Stripe-Account", stripeAuth.stripe_user_id)
        .ok(resp => resp.status === 200 || resp.status === 401 || resp.status === 403);

    if (resp.ok) {
        return resp.body;
    }

    return null;
}

export async function createStripeCharge(params: StripeCreateChargeParams, lightrailStripeSecretKey: string, merchantStripeAccountId: string): Promise<Charge> {
    const lightrailStripe = require("stripe")(lightrailStripeSecretKey);
    lightrailStripe.setApiVersion("2016-07-06");
    params.description = "Gift card purchase";
    console.log(`Creating charge ${JSON.stringify(params)}.`);

    let charge: Charge;
    try {
        charge = await lightrailStripe.charges.create(params, {
            stripe_account: merchantStripeAccountId,
        });
    } catch (err) {
        switch (err.type) {
            case "StripeCardError":
                throw new GiftbitRestError(httpStatusCode.clientError.CONFLICT, "Failed to charge credit card.", "ChargeFailed");
            case "StripeInvalidRequestError":
                throw new GiftbitRestError(httpStatusCode.clientError.CONFLICT, "The stripeCardToken was invalid.", "StripeInvalidRequestError");
            case "RateLimitError":
                throw new GiftbitRestError(httpStatusCode.clientError.TOO_MANY_REQUESTS, `Service was rate limited by dependent service.`, "DependentServiceRateLimited");
            default:
                throw new Error(`An unexpected error occurred while attempting to charge card. error ${err}`);
        }
    }
    console.log(`Created charge ${JSON.stringify(charge)}`);
    return charge;
}

export async function updateStripeCharge(chargeId: string, params: StripeUpdateChargeParams, lightrailStripeSecretKey: string, merchantStripeAccountId: string): Promise<any> {
    const merchantStripe = require("stripe")(lightrailStripeSecretKey);
    merchantStripe.setApiVersion("2016-07-06");
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

export async function createStripeRefund(chargeId: string, lightrailStripeSecretKey: string, merchantStripeAccountId: string, reason?: string): Promise<Refund> {
    const lightrailStripe = require("stripe")(lightrailStripeSecretKey);
    lightrailStripe.setApiVersion("2016-07-06");
    console.log(`Creating refund for charge ${chargeId}.`);
    const refund = await lightrailStripe.refunds.create({
        charge: chargeId,
        metadata: {reason: reason || "not specified"} /* Doesn't show up in charge in stripe. Need to update charge so that it's obvious as to why it was refunded. */
    }, {
        stripe_account: merchantStripeAccountId
    });
    await updateStripeCharge(chargeId, {
        description: reason
    }, lightrailStripeSecretKey, merchantStripeAccountId);
    console.log(JSON.stringify(refund));
    return refund;
}

export async function rollbackCharge(lightrailStripeConfig: StripeModeConfig, merchantStripeConfig: StripeAuth, charge: Charge, reason: string): Promise<void> {
    const refund = await createStripeRefund(charge.id, lightrailStripeConfig.secretKey, merchantStripeConfig.stripe_user_id, reason);
    console.log(`Refunded charge ${charge.id}. Refund: ${JSON.stringify(refund)}.`);
}
