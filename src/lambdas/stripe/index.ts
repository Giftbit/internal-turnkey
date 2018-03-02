import "babel-polyfill";
import * as cassava from "cassava";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as stripeAccess from "../../utils/stripeAccess";
import * as kvsAccess from "../../utils/kvsAccess";
import {StripeConnectState} from "./StripeConnectState";
import {getConfig, TURNKEY_PUBLIC_CONFIG_KEY} from "../../utils/turnkeyConfigStore";
import {TurnkeyPublicConfig} from "../../utils/TurnkeyConfig";

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
router.route(new giftbitRoutes.jwtauth.JwtAuthorizationRoute(authConfigPromise, roleDefinitionsPromise));

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
            const account = await stripeAccess.fetchStripeAccount(stripeAuth, auth.isTestUser());
            if (auth.isTestUser() && (account.email.endsWith("@giftbit.com") || account.email.endsWith("@lightrail.com"))) {
                // Important: this check skips deauthorizing the Stripe token in Stripe.
                // Otherwise, if someone disconnects the Stripe account used for the sign-up demo, the demo will be broken for all users.
                console.log(`Skipping revoking stripe auth since it is an account owned by lightrail. This prevents the stripe account that's connected for the drop-in demo from being deauthorized.`)
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

//noinspection JSUnusedGlobalSymbols
export const handler = router.getLambdaHandler();
