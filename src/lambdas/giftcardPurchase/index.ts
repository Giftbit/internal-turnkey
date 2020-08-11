import * as cassava from "cassava";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as lightrailV2 from "./lightrailV2";

// Wrapping console.log: otherwise all log calls are prefixed with the requestId from the first request the lambda receives
const logFunction = (...args) => console.log(...args);
export const router = new cassava.Router();

router.route(new cassava.routes.LoggingRoute({
    logFunction
}));

router.route(new giftbitRoutes.MetricsRoute({
    logFunction
}));

router.route(new giftbitRoutes.jwtauth.JwtAuthorizationRoute({
    authConfigPromise: giftbitRoutes.secureConfig.fetchFromS3ByEnvVar<giftbitRoutes.secureConfig.AuthenticationConfig>("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_JWT"),
    rolesConfigPromise: giftbitRoutes.secureConfig.fetchFromS3ByEnvVar<any>("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_ROLE_DEFINITIONS"),
    sharedSecretProvider: new giftbitRoutes.jwtauth.sharedSecret.RestSharedSecretProvider(
        `https://${process.env["LIGHTRAIL_DOMAIN"]}${process.env["PATH_TO_MERCHANT_SHARED_SECRET"]}`,
        giftbitRoutes.secureConfig.fetchFromS3ByEnvVar<giftbitRoutes.secureConfig.AssumeScopeToken>("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_ASSUME_STORAGE_SCOPE_TOKEN"))
}));

router.route("/v2/turnkey/giftcard/purchase")
    .method("POST")
    .handler(lightrailV2.purchaseGiftcard);

router.route("/v2/turnkey/giftcard/deliver")
    .method("POST")
    .handler(lightrailV2.deliverGiftcard);

//noinspection JSUnusedGlobalSymbols
export const handler = giftbitRoutes.sentry.wrapLambdaHandler({
    router,
    secureConfig: giftbitRoutes.secureConfig.fetchFromS3ByEnvVar("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_SENTRY")
});
