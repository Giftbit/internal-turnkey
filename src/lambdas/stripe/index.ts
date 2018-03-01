import "babel-polyfill";
import * as cassava from "cassava";
import {httpStatusCode, RestError} from "cassava";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as stripeAccess from "../../utils/stripeAccess";
import * as kvsAccess from "../../utils/kvsAccess";
import {StripeConnectState} from "./StripeConnectState";
import {getConfig, TURNKEY_PUBLIC_CONFIG_KEY} from "../../utils/turnkeyConfigStore";
import {TurnkeyPublicConfig} from "../../utils/TurnkeyConfig";
import * as customer from "../../utils/stripedtos/Customer";
import {StripeAuth} from "../../utils/stripedtos/StripeAuth";
import {errorNotificationWrapper} from "giftbit-cassava-routes/dist/sentry";

export const router = new cassava.Router();

router.route(new cassava.routes.LoggingRoute());
router.route(new giftbitRoutes.HealthCheckRoute("/v1/turnkey/healthCheck"));

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

const authConfigPromise = giftbitRoutes.secureConfig.fetchFromS3ByEnvVar<giftbitRoutes.secureConfig.AuthenticationConfig>("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_JWT");
const roleDefinitionsPromise = giftbitRoutes.secureConfig.fetchFromS3ByEnvVar<any>("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_ROLE_DEFINITIONS");
const assumeGetSharedSecretToken = giftbitRoutes.secureConfig.fetchFromS3ByEnvVar<giftbitRoutes.secureConfig.AssumeScopeToken>("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_ASSUME_STORAGE_SCOPE_TOKEN");
const assumeGetStripeAuthForRetrieveCustomer = giftbitRoutes.secureConfig.fetchFromS3ByEnvVar<giftbitRoutes.secureConfig.AssumeScopeToken>("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_ASSUME_RETRIEVE_STRIPE_CUSTOMER_TOKEN");
router.route(new giftbitRoutes.jwtauth.JwtAuthorizationRoute(authConfigPromise, roleDefinitionsPromise, `https://${process.env["LIGHTRAIL_DOMAIN"]}${process.env["PATH_TO_MERCHANT_SHARED_SECRET"]}`, assumeGetSharedSecretToken));

router.route("/v1/turnkey/stripe")
    .method("POST")
    .handler(async evt => {
        const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
        auth.requireIds("giftbitUserId");
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
        auth.requireIds("giftbitUserId");
        auth.requireScopes("lightrailV1:stripeConnect:write");

        const stripeAuth = await kvsAccess.kvsGet(evt.meta["auth-token"], "stripeAuth");
        if (stripeAuth) {
            await stripeAccess.revokeStripeAuth(stripeAuth, auth.isTestUser());
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
        auth.requireIds("giftbitUserId");
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
        console.log(`request.meta["auth"]: ${JSON.stringify(request.meta["auth"])}`);
        const auth: giftbitRoutes.jwtauth.AuthorizationBadge = request.meta["auth"];
        console.log(`auth: ${JSON.stringify(auth)}`);
        auth.requireIds("giftbitUserId");
        auth.requireScopes("lightrailV1:stripe:customer:show");
        const assumeToken = (await assumeGetStripeAuthForRetrieveCustomer).assumeToken;
        const authorizeAs: string = request.meta["auth-token"].split(".")[1];

        const customerId = auth.metadata.stripeCustomerId;
        if (!customerId) {
            throw new RestError(httpStatusCode.clientError.BAD_REQUEST, "Shopper token metadata.stripeCustomerId cannot be null.");
        }
        const merchantStripeConfig: StripeAuth = await kvsAccess.kvsGet(assumeToken, "stripeAuth", authorizeAs);

        const stripe = require("stripe")(
            merchantStripeConfig.access_token
        );

        console.log(`Received customerId ${customerId}. Will now attempt to lookup customer.`);
        let cus: customer.Customer = await stripe.customers.retrieve(
            customerId,
        );

        return {
            body: {
                customer: customer.toJson(cus)
            }
        };
    });

//noinspection JSUnusedGlobalSymbols
export const handler = errorNotificationWrapper(
    process.env["SECURE_CONFIG_BUCKET"],        // the S3 bucket with the Sentry API key
    process.env["SECURE_CONFIG_KEY_SENTRY"],   // the S3 object key for the Sentry API key
    router,
    router.getLambdaHandler()                   // the cassava handler
);
