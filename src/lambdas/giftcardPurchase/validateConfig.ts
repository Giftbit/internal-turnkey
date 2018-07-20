import * as cassava from "cassava";
import * as kvsAccess from "../../utils/kvsAccess";
import {GiftbitRestError} from "giftbit-cassava-routes/dist/GiftbitRestError";
import {StripeAuth} from "../../utils/stripedtos/StripeAuth";
import {TurnkeyPublicConfig, validateTurnkeyConfig} from "../../utils/TurnkeyConfig";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as stripeAccess from "../../utils/stripeAccess";
import {StripeModeConfig} from "../../utils/stripedtos/StripeConfig";
import * as turnkeyConfigUtil from "../../utils/turnkeyConfigStore";

export async function validateConfig(auth: giftbitRoutes.jwtauth.AuthorizationBadge, assumeToken: string, authorizeAs: string): Promise<{ config: TurnkeyPublicConfig, merchantStripeConfig: StripeAuth, lightrailStripeConfig: StripeModeConfig }> {
    try {
        const config: TurnkeyPublicConfig = await turnkeyConfigUtil.getConfig(assumeToken, authorizeAs);
        console.log(`Fetched public turnkey config: ${JSON.stringify(config)}`);
        validateTurnkeyConfig(config);

        const merchantStripeConfig: StripeAuth = await kvsAccess.kvsGet(assumeToken, "stripeAuth", authorizeAs);
        const lightrailStripeConfig = await stripeAccess.getStripeConfig(auth.isTestUser());
        validateStripeConfig(merchantStripeConfig, lightrailStripeConfig);
        return {config, merchantStripeConfig, lightrailStripeConfig};
    } catch (err) {
        giftbitRoutes.sentry.sendErrorNotification(err);
        throw err;
    }
}

function validateStripeConfig(merchantStripeConfig: StripeAuth, lightrailStripeConfig: StripeModeConfig): void {
    if (!merchantStripeConfig || !merchantStripeConfig.stripe_user_id) {
        throw new GiftbitRestError(424, "Merchant stripe config stripe_user_id must be set.", "MissingStripeUserId");
    }
    if (!lightrailStripeConfig || !lightrailStripeConfig.secretKey) {
        console.log("Lightrail stripe secretKey could not be loaded from s3 secure config.");
        throw new cassava.RestError(cassava.httpStatusCode.serverError.INTERNAL_SERVER_ERROR);
    }
}
