import "babel-polyfill";
import * as cassava from "cassava";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as stripeAccess from "./stripeAccess";

export const router = new cassava.Router();

router.route(new cassava.routes.LoggingRoute());
router.route(new giftbitRoutes.HealthCheckRoute("/v1/turnkey/healthCheck"));

router.route("/v1/turnkey/stripecallback")
    .method("GET")
    .handler(async evt => {
        evt.requireQueryStringParameter("scope", ["read_write"]);
        evt.requireQueryStringParameter("state");
        evt.requireQueryStringParameter("code");

        const creds = await stripeAccess.fetchStripeCredentials(evt.queryStringParameters["code"]);

        return {
            body: {
                creds: creds    // TODO: store, don't return
            }
        };
    });

const authConfigPromise = giftbitRoutes.secureConfig.fetchFromS3ByEnvVar<any>("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_JWT");
const roleDefinitionsPromise = giftbitRoutes.secureConfig.fetchFromS3ByEnvVar<any>("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_ROLE_DEFINITIONS");
router.route(new giftbitRoutes.jwtauth.JwtAuthorizationRoute(authConfigPromise, roleDefinitionsPromise));

router.route("/v1/turnkey/stripeconnect")
    .method("GET")
    .handler(async evt => {
        const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
        auth.requireIds("giftbitUserId");

        // TODO check if already connected
        // TODO build state out of giftbitUserId and a secure token

        return {
            statusCode: 302,
            body: null,
            headers: {
                Location: `https://connect.stripe.com/oauth/authorize?response_type=code&scope=read_write&client_id=${encodeURIComponent(stripeAccess.stripeClientId)}&state=${encodeURIComponent(auth.giftbitUserId)}`
            }
        };
    });

router.route("/v1/turnkey/stripe")
    .method("GET")
    .handler(async evt => {
        const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
        auth.requireIds("giftbitUserId");

        return {
            body: {
                domain: process.env["LIGHTRAIL_DOMAIN"]
            }
        };
    });

//noinspection JSUnusedGlobalSymbols
export const handler = router.getLambdaHandler();
