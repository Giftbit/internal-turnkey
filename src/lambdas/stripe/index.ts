import "babel-polyfill";
import * as cassava from "cassava";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as stripeAccess from "./stripeAccess";
import * as kvsAccess from "../../utils/kvsAccess";
import {StripeConnectState} from "./StripeConnectState";
import {getConfig, TURNKEY_PUBLIC_CONFIG_KEY} from "../../utils/turnkeyConfigStore";

export const router = new cassava.Router();

router.route(new cassava.routes.LoggingRoute());
router.route(new giftbitRoutes.HealthCheckRoute("/v1/turnkey/healthCheck"));

router.route("/v1/turnkey/stripe/callback")
    .method("GET")
    .handler(async evt => {
        evt.requireQueryStringParameter("scope", ["read_write"]);
        evt.requireQueryStringParameter("state");
        evt.requireQueryStringParameter("code");

        const state = await StripeConnectState.get(evt.queryStringParameters["state"]);
        if (!state) {
            throw new cassava.RestError(cassava.httpStatusCode.clientError.UNPROCESSABLE_ENTITY, "Stripe Connect link has expired.  Please start again.");
        }

        const stripeAuth = await stripeAccess.fetchStripeAuth(evt.queryStringParameters["code"]);
        const auth = new giftbitRoutes.jwtauth.AuthorizationBadge(state.jwtPayload);
        const authToken = auth.sign((await authConfigPromise).secretkey);
        await kvsAccess.kvsPut(authToken, "stripeAuth", stripeAuth);
        let turnkeyPublicConifg = await getConfig(authToken);
        turnkeyPublicConifg.stripePublicKey = stripeAuth.stripe_publishable_key;
        await kvsAccess.kvsPut(authToken, TURNKEY_PUBLIC_CONFIG_KEY, turnkeyPublicConifg);

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
            const account = await stripeAccess.fetchStripeAccount(stripeAuth);
            if (account) {
                return {
                    statusCode: 302,
                    body: null,
                    headers: {
                        Location: `https://${process.env["LIGHTRAIL_WEBAPP_DOMAIN"]}/app/`
                    }
                };
            }
        }

        const stripeConnectState = await StripeConnectState.create(auth);
        const stripeCallbackLocation = `https://${process.env["LIGHTRAIL_WEBAPP_DOMAIN"]}/v1/turnkey/stripe/callback`;
        const stripeConfig = await stripeAccess.getStripeConfig();
        const location = `https://connect.stripe.com/oauth/authorize?response_type=code&scope=read_write&client_id=${encodeURIComponent(stripeConfig.clientId)}&redirect_uri=${encodeURIComponent(stripeCallbackLocation)}&state=${encodeURIComponent(stripeConnectState.uuid)}`;

        return {
            statusCode: 302,
            body: {
                location
            },
            headers: {
                Location: location
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
            await stripeAccess.revokeStripeAuth(stripeAuth);
            await kvsAccess.kvsDelete(evt.meta["auth-token"], "stripeAuth");
        }

        return {
            body: {
                success: true
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

        const account = await stripeAccess.fetchStripeAccount(stripeAuth);
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
