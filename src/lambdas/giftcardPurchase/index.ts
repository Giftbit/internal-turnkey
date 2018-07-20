import * as cassava from "cassava";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as metrics from "giftbit-lambda-metricslib";
import * as lightrailV1 from "./lightrailV1";
import * as lightrailV2 from "./lightrailV2";

export const router = new cassava.Router();

router.route(new cassava.routes.LoggingRoute());

router.route(new giftbitRoutes.jwtauth.JwtAuthorizationRoute(
    giftbitRoutes.secureConfig.fetchFromS3ByEnvVar<giftbitRoutes.secureConfig.AuthenticationConfig>("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_JWT"),
    giftbitRoutes.secureConfig.fetchFromS3ByEnvVar<any>("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_ROLE_DEFINITIONS"),
    `https://${process.env["LIGHTRAIL_DOMAIN"]}${process.env["PATH_TO_MERCHANT_SHARED_SECRET"]}`,
    giftbitRoutes.secureConfig.fetchFromS3ByEnvVar<giftbitRoutes.secureConfig.AssumeScopeToken>("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_ASSUME_STORAGE_SCOPE_TOKEN"))
);

/**
 * Deprecated. Requests should be using /turnkey/giftcard/purchase
 */
router.route("/v1/turnkey/purchaseGiftcard")
    .method("POST")
    .handler(lightrailV1.purchaseGiftcard);

router.route("/v1/turnkey/giftcard/purchase")
    .method("POST")
    .handler(lightrailV1.purchaseGiftcard);

router.route("/v1/turnkey/giftcard/deliver")
    .method("POST")
    .handler(lightrailV1.deliverGiftcard);

router.route("/v2/turnkey/giftcard/purchase")
    .method("POST")
    .handler(lightrailV2.purchaseGiftcard);

router.route("/v2/turnkey/giftcard/deliver")
    .method("POST")
    .handler(lightrailV2.deliverGiftcard);

//noinspection JSUnusedGlobalSymbols
export const handler = metrics.wrapLambdaHandler({
    secureConfig: giftbitRoutes.secureConfig.fetchFromS3ByEnvVar("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_DATADOG"),
    handler: giftbitRoutes.sentry.wrapLambdaHandler({
        router,
        secureConfig: giftbitRoutes.secureConfig.fetchFromS3ByEnvVar("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_SENTRY")
    })
});
