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
        const scope = evt.queryStringParameters["scope"];
        const authorizationCode = evt.queryStringParameters["code"];

        if (scope !== "read_write") {
            console.error("Bad call to stripecallback: expected query parameter scope to equal 'read_write'.", evt.queryStringParameters);
            throw new cassava.RestError(cassava.httpStatusCode.clientError.BAD_REQUEST);
        }
        if (!authorizationCode) {
            console.error("Bad call to stripecallback: expected query parameter code.", evt.queryStringParameters);
            throw new cassava.RestError(cassava.httpStatusCode.clientError.BAD_REQUEST);
        }

        const creds = await stripeAccess.fetchStripeCredentials(authorizationCode);

        return {
            body: {
                creds: creds    // TODO: store, don't return
            }
        };
    });

const authConfigPromise = giftbitRoutes.secureConfig.fetchFromS3ByEnvVar<any>("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_JWT");
const roleDefinitionsPromise = giftbitRoutes.secureConfig.fetchFromS3ByEnvVar<any>("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_ROLE_DEFINITIONS");
router.route(new giftbitRoutes.jwtauth.JwtAuthorizationRoute(authConfigPromise, roleDefinitionsPromise));

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
