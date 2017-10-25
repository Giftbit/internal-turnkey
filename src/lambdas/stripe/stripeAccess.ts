import * as superagent from "superagent";
import {StripeAuthResponse} from "./StripeAuthResponse";
import {StripeAuthErrorResponse} from "./StripeAuthErrorResponse";

const stripeClientId: string = "ca_BeEfEZCpfrRFtHK3olpVsvWR8CcuwX1q";  // TODO store and fetch, don't hard code

export async function fetchStripeCredentials(authorizationCode: string): Promise<StripeAuthResponse> {
    const resp = await superagent.post("https://connect.stripe.com/oauth/token")
        .query({
            client_secret: stripeClientId,
            code: authorizationCode,
            grant_type: "authorization_code"
        })
        .ok(() => true);

    if (resp.ok) {
        const stripeAuthResponse: StripeAuthResponse = resp.body;
        if (!stripeAuthResponse.token_type
            || !stripeAuthResponse.stripe_publishable_key
            || !stripeAuthResponse.scope
            || !stripeAuthResponse.stripe_user_id
            || !stripeAuthResponse.refresh_token
            || !stripeAuthResponse.access_token) {
            const msg = "POSTing to https://connect.stripe.com/oauth/token generated a 200 response but the body does not match the expected output.";
            console.error(msg, {
                ...resp.body,
                stripe_publishable_key: stripeAuthResponse.stripe_publishable_key ? "***redacted***" : "!!!missing!!!",
                stripe_user_id: stripeAuthResponse.stripe_user_id ? "***redacted***" : "!!!missing!!!",
                refresh_token: stripeAuthResponse.refresh_token ? "***redacted***" : "!!!missing!!!",
                access_token: stripeAuthResponse.access_token ? "***redacted***" : "!!!missing!!!",
            });
            throw new Error(msg);
        }
        return stripeAuthResponse;
    }

    if ((resp.body as StripeAuthErrorResponse).error && (resp.body as StripeAuthErrorResponse).error_description) {
        console.error(`Unable to complete Stripe authorization.`, resp.text);
        throw new Error(resp.body.error_description);
    }

    console.error("Unexpected Stripe authorization error.", resp.status, resp.text);
    throw new Error("Unexpected Stripe authorization error.");
}
