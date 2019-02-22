import * as cassava from "cassava";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as stripeAccess from "../../utils/stripeAccess";
import * as kvsAccess from "../../utils/kvsAccess";
import {StripeConnectState} from "./StripeConnectState";
import {getConfig, TURNKEY_PUBLIC_CONFIG_KEY} from "../../utils/turnkeyConfigStore";
import {TurnkeyPublicConfig} from "../../utils/TurnkeyConfig";
import * as customer from "../../utils/stripedtos/Customer";
import {StripeAuth} from "../../utils/stripedtos/StripeAuth";

// Wrapping console.log: otherwise all log calls are prefixed with the requestId from the first request the lambda receives
const logFunction = (...args) => console.log(...args);
export const router = new cassava.Router();

router.route(new cassava.routes.LoggingRoute({
    logFunction
}));
router.route(new giftbitRoutes.HealthCheckRoute("/v1/turnkey/healthCheck"));

router.route(new giftbitRoutes.MetricsRoute({
    logFunction
}));

router.route("/v1/turnkey/stripe/callback")
    .method("GET")
    .handler(async evt => {
        evt.requireQueryStringParameter("state");

        const state = await StripeConnectState.get(evt.queryStringParameters["state"]);
        if (!state) {
            console.log(`Stripe connect error: Stripe Connect link has expired state='${evt.queryStringParameters["state"]}'`);
            throw new cassava.RestError(cassava.httpStatusCode.clientError.UNPROCESSABLE_ENTITY, "Stripe Connect link has expired.  Please start again.");
        }

        if (evt.queryStringParameters["error"]) {
            console.log(`Stripe Connect error error='${evt.queryStringParameters["error"]}' error_description='${evt.queryStringParameters["error_description"]}' state='${evt.queryStringParameters["state"]}' gui='${state && state.jwtPayload && state.jwtPayload.g && state.jwtPayload.g.gui}'`);
        } else {
            evt.requireQueryStringParameter("code");
            evt.requireQueryStringParameter("scope", ["read_write"]);

            const auth = new giftbitRoutes.jwtauth.AuthorizationBadge(state.jwtPayload);
            const stripeAuth = await stripeAccess.fetchStripeAuth(evt.queryStringParameters["code"], auth.isTestUser());
            const authToken = auth.sign((await authConfigPromise).secretkey);
            await kvsAccess.kvsPut(authToken, "stripeAuth", stripeAuth);

            // Store public config.
            const turnkeyPublicConfig: any = await getConfig(authToken) || {} as Partial<TurnkeyPublicConfig>;
            turnkeyPublicConfig.stripePublicKey = stripeAuth.stripe_publishable_key;
            await kvsAccess.kvsPut(authToken, TURNKEY_PUBLIC_CONFIG_KEY, turnkeyPublicConfig);
        }

        return {
            statusCode: 302,
            body: null,
            headers: {
                Location: `https://${process.env["LIGHTRAIL_WEBAPP_DOMAIN"]}/app/`
            }
        };
    });

// This is a placeholder endpoint to receive webhook notifications from Stripe so that we comply with their requirements for extensions and platforms:
// https://docs.google.com/document/d/1r5CA-as-l0FQ-yj9gru8xtRxrkXx1paau8_iMQAX8CQ/edit?ts=5b16ab25#
// If we start to care about what's coming into this endpoint, we should validate the events we're receiving:
// https://stripe.com/docs/webhooks/signatures
router.route("/v1/turnkey/stripe/webhook")
    .method("POST")
    .handler(async evt => {
        console.log(JSON.stringify(evt));
        return {
            statusCode: 200,
            body: null,
        };
    });

const authConfigPromise = giftbitRoutes.secureConfig.fetchFromS3ByEnvVar<giftbitRoutes.secureConfig.AuthenticationConfig>("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_JWT");
const roleDefinitionsPromise = giftbitRoutes.secureConfig.fetchFromS3ByEnvVar<any>("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_ROLE_DEFINITIONS");
const assumeGetSharedSecretToken = giftbitRoutes.secureConfig.fetchFromS3ByEnvVar<giftbitRoutes.secureConfig.AssumeScopeToken>("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_ASSUME_STORAGE_SCOPE_TOKEN");
const assumeTokenForStripeAuth = giftbitRoutes.secureConfig.fetchFromS3ByEnvVar<giftbitRoutes.secureConfig.AssumeScopeToken>("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_ASSUME_RETRIEVE_STRIPE_AUTH");
router.route(new giftbitRoutes.jwtauth.JwtAuthorizationRoute({
    authConfigPromise,
    rolesConfigPromise: roleDefinitionsPromise,
    sharedSecretProvider: new giftbitRoutes.jwtauth.sharedSecret.RestSharedSecretProvider(`https://${process.env["LIGHTRAIL_DOMAIN"]}${process.env["PATH_TO_MERCHANT_SHARED_SECRET"]}`, assumeGetSharedSecretToken)
}));

router.route("/v1/turnkey/stripe")
    .method("POST")
    .handler(async evt => {
        const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
        auth.requireIds("userId");
        auth.requireScopes("lightrailV1:stripeConnect:write");

        const stripeAuth = await kvsAccess.kvsGet(evt.meta["auth-token"], "stripeAuth");
        if (stripeAuth) {
            const account = await stripeAccess.fetchStripeAccount(stripeAuth, auth.isTestUser());
            if (account) {
                return {
                    body: {
                        connected: true,
                        location: `https://${process.env["LIGHTRAIL_WEBAPP_DOMAIN"]}/app/`
                    }
                };
            }
        }

        const stripeConnectState = await StripeConnectState.create(auth);
        const stripeCallbackLocation = `https://${process.env["LIGHTRAIL_WEBAPP_DOMAIN"]}/v1/turnkey/stripe/callback`;
        const stripeConfig = await stripeAccess.getStripeConfig(auth.isTestUser());

        return {
            body: {
                connected: false,
                location: `https://connect.stripe.com/oauth/authorize?response_type=code&scope=read_write&client_id=${encodeURIComponent(stripeConfig.clientId)}&redirect_uri=${encodeURIComponent(stripeCallbackLocation)}&state=${encodeURIComponent(stripeConnectState.uuid)}`
            }
        };
    });

router.route("/v1/turnkey/stripe")
    .method("DELETE")
    .handler(async evt => {
        const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
        auth.requireIds("userId");
        auth.requireScopes("lightrailV1:stripeConnect:write");

        const stripeAuth = await kvsAccess.kvsGet(evt.meta["auth-token"], "stripeAuth");
        if (stripeAuth) {
            const account = await stripeAccess.fetchStripeAccount(stripeAuth, auth.isTestUser());
            if (auth.isTestUser() && account.email && (account.email.endsWith("@giftbit.com") || account.email.endsWith("@lightrail.com"))) {
                // Important: this check skips deauthorizing the Stripe connect access token in Stripe for lightrail stripe accounts.
                // Otherwise, if someone disconnects the Stripe account used for the sign-up demo, the demo will be broken for all users.
                console.log(`Skipping revoking stripe auth since it is an account owned by lightrail. This prevents the stripe account that's connected for the drop-in demo from being deauthorized. Account id = ${account.id} and email = ${account.email}.`);
            } else {
                await stripeAccess.revokeStripeAuth(stripeAuth, auth.isTestUser());
            }

            await kvsAccess.kvsDelete(evt.meta["auth-token"], "stripeAuth");
        }

        return {
            body: {
                connected: false
            }
        };
    });

router.route("/v1/turnkey/stripe")
    .method("GET")
    .handler(async evt => {
        const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
        auth.requireIds("userId");
        auth.requireScopes("lightrailV1:stripeConnect:read");

        const stripeAuth = await kvsAccess.kvsGet(evt.meta["auth-token"], "stripeAuth");
        if (!stripeAuth) {
            return {
                body: {
                    connected: false
                }
            };
        }

        const account = await stripeAccess.fetchStripeAccount(stripeAuth, auth.isTestUser());
        if (!account) {
            return {
                body: {
                    connected: false
                }
            };
        }

        return {
            body: {
                connected: true
            }
        };
    });

router.route("/v1/turnkey/stripe/customer")
    .method("GET")
    .handler(async request => {
        const auth: giftbitRoutes.jwtauth.AuthorizationBadge = request.meta["auth"];
        auth.requireIds("userId");
        auth.requireScopes("lightrailV1:stripe:customer:show");
        const assumeToken = (await assumeTokenForStripeAuth).assumeToken;
        const authorizeAs = auth.getAuthorizeAsPayload();

        const customerId = auth.metadata ? auth.metadata.stripeCustomerId : null;
        if (!customerId) {
            throw new cassava.RestError(cassava.httpStatusCode.clientError.UNPROCESSABLE_ENTITY, "Shopper token metadata.stripeCustomerId cannot be null.");
        }
        const merchantStripeConfig: StripeAuth = await kvsAccess.kvsGet(assumeToken, "stripeAuth", authorizeAs);

        if (!merchantStripeConfig) {
            throw new cassava.RestError(cassava.httpStatusCode.clientError.UNPROCESSABLE_ENTITY, "You must connect your Stripe account to your Lightrail account.");
        }
        const lightrailStripeConfig = await stripeAccess.getStripeConfig(auth.isTestUser());
        const stripe = require("stripe")(
            lightrailStripeConfig.secretKey
        );
        stripe.setApiVersion("2016-07-06");

        console.log(`Received customerId ${customerId}. Will now attempt to lookup customer.`);
        let cus: customer.Customer;
        try {
            cus = await stripe.customers.retrieve(customerId, {stripe_account: merchantStripeConfig.stripe_user_id});
        } catch (err) {
            console.log(`err occurred while retrieving customer. ${JSON.stringify(err)}`);
            throw new cassava.RestError(cassava.httpStatusCode.clientError.BAD_REQUEST, "An exception occurred while retrieving customer. The customer may not exist.");
        }

        return {
            body: {
                customer: customer.toJson(cus)
            }
        };
    });

//noinspection JSUnusedGlobalSymbols
export const handler = giftbitRoutes.sentry.wrapLambdaHandler({
    router,
    secureConfig: giftbitRoutes.secureConfig.fetchFromS3ByEnvVar("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_SENTRY")
});
