import * as cassava from "cassava";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as lightrail from "lightrail-client";
import * as metrics from "giftbit-lambda-metricslib";
import {Card} from "lightrail-client/dist/model";
import * as turnkeyConfigUtil from "../../utils/turnkeyConfigStore";
import * as giftcardPurchaseParams from "./GiftcardPurchaseParams";
import {GiftcardPurchaseParams} from "./GiftcardPurchaseParams";
import * as kvsAccess from "../../utils/kvsAccess";
import * as stripeAccess from "../../utils/stripeAccess";
import * as lightrailV1Access from "./lightrailV1Access";
import {createCharge, createRefund, updateCharge} from "./stripeRequests";
import {GiftbitRestError} from "giftbit-cassava-routes/dist/GiftbitRestError";
import {Charge} from "../../utils/stripedtos/Charge";
import {StripeAuth} from "../../utils/stripedtos/StripeAuth";
import {StripeModeConfig} from "../../utils/stripedtos/StripeConfig";
import {setParamsFromRequest} from "./DeliverGiftCardParams";
import {passesFraudCheck} from "./passesFraudCheck";
import {emailGiftToRecipient} from "./emailGiftToRecipient";
import {TurnkeyPublicConfig, validateTurnkeyConfig} from "../../utils/TurnkeyConfig";

export const router = new cassava.Router();

router.route(new cassava.routes.LoggingRoute());

const assumeGiftcardPurchaseToken = giftbitRoutes.secureConfig.fetchFromS3ByEnvVar<giftbitRoutes.secureConfig.AssumeScopeToken>("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_ASSUME_GIFTCARD_PURCHASE_TOKEN");
const assumeGiftcardDeliverToken = giftbitRoutes.secureConfig.fetchFromS3ByEnvVar<giftbitRoutes.secureConfig.AssumeScopeToken>("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_ASSUME_GIFTCARD_DELIVER_TOKEN");
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
    .handler(async evt => {
        return await purchaseGiftcard(evt);
    });


router.route("/v1/turnkey/giftcard/purchase")
    .method("POST")
    .handler(async evt => {
        return await purchaseGiftcard(evt);
    });

async function purchaseGiftcard(evt: cassava.RouterEvent): Promise<cassava.RouterResponse> {
    console.log("Received request:" + JSON.stringify(evt));
    const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
    metrics.histogram("turnkey.giftcardpurchase", 1, [`mode:${auth.isTestUser() ? "test" : "live"}`]);
    metrics.flush();
    auth.requireIds("giftbitUserId");
    auth.requireScopes("lightrailV1:purchaseGiftcard");

    const authorizeAs = auth.getAuthorizeAsPayload();
    console.log("AuthorizeAs: " + authorizeAs);
    const assumeToken = (await assumeGiftcardPurchaseToken).assumeToken;

    lightrail.configure({
        apiKey: assumeToken,
        restRoot: "https://" + process.env["LIGHTRAIL_DOMAIN"] + "/v1/",
        logRequests: true,
        additionalHeaders: {AuthorizeAs: authorizeAs}
    });

    const {config, merchantStripeConfig, lightrailStripeConfig} = await validateConfig(auth, assumeToken, authorizeAs);
    const params = validateGiftcardPurchaseParams(evt, auth);
    const chargeAndCardCoreMetadata = {
        sender_name: params.senderName,
        sender_email: params.senderEmail,
        recipient_email: params.recipientEmail,
        message: params.message
    };

    const usingSavedCard: boolean = params.stripeCardId !== null;
    let charge: Charge = await createCharge({
        amount: params.initialValue,
        currency: config.currency,
        source: usingSavedCard ? params.stripeCardId : params.stripeCardToken,
        receipt_email: params.senderEmail,
        metadata: chargeAndCardCoreMetadata,
        customer: usingSavedCard ? params.stripeCustomerId : undefined
    }, lightrailStripeConfig.secretKey, merchantStripeConfig.stripe_user_id);

    let card: Card;

    const passedFraudCheck = await passesFraudCheck(params, charge, evt);
    if (!passedFraudCheck) {
        await rollback(lightrailStripeConfig, merchantStripeConfig, charge, null, "The order failed fraud check.");
        throw new GiftbitRestError(cassava.httpStatusCode.clientError.BAD_REQUEST, "Failed to charge credit card.", "ChargeFailed");
    }

    try {
        const cardMetadata = {
            ...chargeAndCardCoreMetadata,
            charge_id: charge.id,
            "giftbit-note": {note: `charge_id: ${charge.id}, sender: ${params.senderEmail}, recipient: ${params.recipientEmail}`}
        };
        card = await lightrailV1Access.createCard(charge.id, params, config, cardMetadata);
    } catch (err) {
        console.log(`An error occurred during card creation. Error: ${JSON.stringify(err)}.`);
        await rollback(lightrailStripeConfig, merchantStripeConfig, charge, card, "Refunded due to an unexpected error during gift card creation in Lightrail.");

        if (err.status === 400) {
            throw new cassava.RestError(cassava.httpStatusCode.clientError.BAD_REQUEST, err.body.message);
        } else {
            throw new cassava.RestError(cassava.httpStatusCode.serverError.INTERNAL_SERVER_ERROR);
        }
    }

    try {
        await updateCharge(charge.id, {
            description: `${config.companyName} gift card. Purchase reference number: ${card.cardId}.`,
            metadata: {...chargeAndCardCoreMetadata, lightrail_gift_card_id: card.cardId}
        }, lightrailStripeConfig.secretKey, merchantStripeConfig.stripe_user_id);
        await emailGiftToRecipient({
            fullcode: (await lightrail.cards.getFullcode(card.cardId)).code,
            recipientEmail: params.recipientEmail,
            message: params.message,
            senderName: params.senderName,
            initialValue: params.initialValue
        }, config);
    } catch (err) {
        console.log(`An error occurred while attempting to deliver fullcode to recipient. Error: ${err}.`);
        await rollback(lightrailStripeConfig, merchantStripeConfig, charge, card, `Refunded due to an unexpected error during the gift card delivery step. The gift card ${card.cardId} will be cancelled in Lightrail.`);
        throw new GiftbitRestError(cassava.httpStatusCode.serverError.INTERNAL_SERVER_ERROR);
    }

    return {
        body: {
            cardId: card.cardId
        }
    };
}

router.route("/v1/turnkey/giftcard/deliver")
    .method("POST")
    .handler(async request => {
        console.log("Received request for deliver gift card:" + JSON.stringify(request));
        const auth: giftbitRoutes.jwtauth.AuthorizationBadge = request.meta["auth"];
        metrics.histogram("turnkey.giftcarddeliver", 1, [`mode:${auth.isTestUser() ? "test" : "live"}`]);
        metrics.flush();
        auth.requireIds("giftbitUserId");
        auth.requireScopes("lightrailV1:card:deliver");

        const authorizeAs = auth.getAuthorizeAsPayload();
        const assumeToken = (await assumeGiftcardDeliverToken).assumeToken;
        const params = setParamsFromRequest(request);

        lightrail.configure({
            apiKey: assumeToken,
            restRoot: "https://" + process.env["LIGHTRAIL_DOMAIN"] + "/v1/",
            logRequests: true,
            additionalHeaders: {AuthorizeAs: authorizeAs}
        });

        const config: TurnkeyPublicConfig = await turnkeyConfigUtil.getConfig(assumeToken, authorizeAs);
        console.log(`Fetched public turnkey config: ${JSON.stringify(config)}`);
        validateTurnkeyConfig(config);

        const transactionsResp = await lightrail.cards.transactions.getTransactions(params.cardId, {transactionType: "INITIAL_VALUE"});
        const transaction = transactionsResp.transactions[0];
        console.log("Retrieved transaction:", JSON.stringify(transaction));

        const card = await lightrail.cards.getCardById(params.cardId);
        if (!card) {
            throw new GiftbitRestError(cassava.httpStatusCode.clientError.BAD_REQUEST, `parameter cardId did not correspond to a card`, "InvalidParamCardIdNoCardFound");
        }
        if (card.cardType !== "GIFT_CARD") {
            console.log(`Gift card deliver endpoint called with a card that is not of type GIFT_CARD. card: ${JSON.stringify(card)}.`);
            throw new GiftbitRestError(cassava.httpStatusCode.clientError.BAD_REQUEST, `parameter cardId must be for a GIFT_CARD`, "InvalidParamCardId");
        }

        await lightrailV1Access.changeContact(card, params.recipientEmail);

        if (!params.message) {
            params.message = transaction.metadata ? transaction.metadata.message : null;
        }
        if (!params.senderName) {
            params.senderName = transaction.metadata ? transaction.metadata.sender_name : null;
        }

        try {
            await emailGiftToRecipient({
                fullcode: (await lightrail.cards.getFullcode(card.cardId)).code,
                recipientEmail: params.recipientEmail,
                message: params.message,
                senderName: params.senderName,
                initialValue: transaction.value
            }, config);
        } catch (err) {
            console.log(`An error occurred while attempting to deliver fullcode to recipient. Error: ${err}.`);
            throw new GiftbitRestError(cassava.httpStatusCode.serverError.INTERNAL_SERVER_ERROR);
        }

        return {
            body: {
                success: true,
                params: params
            }
        };
    });

function validateStripeConfig(merchantStripeConfig: StripeAuth, lightrailStripeConfig: StripeModeConfig): void {
    if (!merchantStripeConfig || !merchantStripeConfig.stripe_user_id) {
        throw new GiftbitRestError(424, "Merchant stripe config stripe_user_id must be set.", "MissingStripeUserId");
    }
    if (!lightrailStripeConfig || !lightrailStripeConfig.secretKey) {
        console.log("Lightrail stripe secretKey could not be loaded from s3 secure config.");
        throw new cassava.RestError(cassava.httpStatusCode.serverError.INTERNAL_SERVER_ERROR);
    }
}

//noinspection JSUnusedGlobalSymbols
export const handler = metrics.wrapLambdaHandler({
    secureConfig: giftbitRoutes.secureConfig.fetchFromS3ByEnvVar("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_DATADOG"),
    handler: giftbitRoutes.sentry.wrapLambdaHandler({
        router,
        secureConfig: giftbitRoutes.secureConfig.fetchFromS3ByEnvVar("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_SENTRY")
    })
});

async function validateConfig(auth: giftbitRoutes.jwtauth.AuthorizationBadge, assumeToken: string, authorizeAs: string): Promise<{ config: TurnkeyPublicConfig, merchantStripeConfig: StripeAuth, lightrailStripeConfig: StripeModeConfig }> {
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

function validateGiftcardPurchaseParams(request: cassava.RouterEvent, auth: giftbitRoutes.jwtauth.AuthorizationBadge): GiftcardPurchaseParams {
    const params = giftcardPurchaseParams.setParamsFromRequest(request, auth);
    giftcardPurchaseParams.validateParams(params);
    return params;
}

async function rollback(lightrailStripeConfig: StripeModeConfig, merchantStripeConfig: StripeAuth, charge: Charge, card: Card, reason: string): Promise<void> {
    const refund = await createRefund(charge.id, lightrailStripeConfig.secretKey, merchantStripeConfig.stripe_user_id, reason);
    console.log(`Refunded charge ${charge.id}. Refund: ${JSON.stringify(refund)}.`);
    if (card) {
        const cancel = await lightrail.cards.cancelCard(card, card.cardId + "-cancel");
        console.log(`Cancelled card ${card.cardId}. Cancel response: ${cancel}.`);
    }
}

