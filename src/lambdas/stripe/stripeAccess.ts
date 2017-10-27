import * as superagent from "superagent";
import {StripeAuth} from "./StripeAuth";
import {StripeAuthErrorResponse} from "./StripeAuthErrorResponse";
import {httpStatusCode, RestError} from "cassava";
import {StripeAccount} from "./StripeAccount";

export const stripeClientId: string = "ca_BeEfEZCpfrRFtHK3olpVsvWR8CcuwX1q";  // TODO store and fetch, don't hard code
const stripeApiKey: string = "sk_test_Febdx6DaFUrKUNBT0zGTivZp";

export async function fetchStripeAuth(authorizationCode: string): Promise<StripeAuth> {
    const resp = await superagent.post("https://connect.stripe.com/oauth/token")
        .query({
            client_secret: stripeApiKey,
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

export async function fetchStripeAccount(stripeAuth: StripeAuth): Promise<StripeAccount> {
    const resp = await superagent.get(`https://${stripeApiKey}:@api.stripe.com/v1/accounts/${stripeAuth.stripe_user_id}`)
        .set("Stripe-Account", stripeAuth.stripe_user_id)
        .ok(() => true);

    if (resp.ok) {
        return resp.body;
    } else if (resp.status === 401) {
        return null;
    }

    console.error("Unexpected error accessing Stripe account.", resp.status, resp.text);
    throw new Error("Unexpected Stripe authorization error.");
}
