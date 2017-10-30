import * as superagent from "superagent";
import * as giftbitRoutes from "giftbit-cassava-routes";
import {StripeAccount} from "./StripeAccount";
import {StripeAuth} from "./StripeAuth";
import {StripeAuthErrorResponse} from "./StripeAuthErrorResponse";
import {httpStatusCode, RestError} from "cassava";
import {StripeConfig} from "./StripeConfig";

const stripeConfigPromise = giftbitRoutes.secureConfig.fetchFromS3ByEnvVar<StripeConfig>("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_STRIPE");

export async function getStripeConfig(): Promise<StripeConfig> {
    return stripeConfigPromise;
}

export async function fetchStripeAuth(authorizationCode: string): Promise<StripeAuth> {
    const stripeConfig = await stripeConfigPromise;
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

export async function revokeStripeAuth(stripeAuth: StripeAuth): Promise<void> {
    const stripeConfig = await stripeConfigPromise;
    await superagent.post(`https://${stripeConfig.secretKey}:@connect.stripe.com/oauth/deauthorize`)
        .field({
            client_id: stripeConfig.clientId,
            stripe_user_id: stripeAuth.stripe_user_id
        })
        .ok(resp => resp.status < 400 || resp.status === 401);
}

export async function fetchStripeAccount(stripeAuth: StripeAuth): Promise<StripeAccount> {
    const stripeConfig = await stripeConfigPromise;
    const resp = await superagent.get(`https://${stripeConfig.secretKey}:@api.stripe.com/v1/accounts/${stripeAuth.stripe_user_id}`)
        .set("Stripe-Account", stripeAuth.stripe_user_id)
        .ok(resp => resp.status === 200 || resp.status === 401);

    if (resp.ok) {
        return resp.body;
    }

    return null;
}
