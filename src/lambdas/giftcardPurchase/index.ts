import "babel-polyfill";
import * as cassava from "cassava";
import {httpStatusCode, RestError, RouterEvent} from "cassava";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as lightrail from "lightrail-client";
import {Card} from "lightrail-client/dist/model";
import * as turnkeyConfigUtil from "../../utils/turnkeyConfigStore";
import * as giftcardPurchaseParams from "./GiftcardPurchaseParams";
import {GiftcardPurchaseParams} from "./GiftcardPurchaseParams";
import {RECIPIENT_EMAIL} from "./RecipientEmail";
import {FULLCODE_REPLACMENT_STRING, TurnkeyPublicConfig, validateTurnkeyConfig} from "../../utils/TurnkeyConfig";
import * as kvsAccess from "../../utils/kvsAccess";
import * as stripeAccess from "../../utils/stripeAccess";
import {EmailGiftCardParams} from "./EmailGiftCardParams";
import {createCharge, createRefund, updateCharge} from "./stripeRequests";
import * as metrics from "giftbit-lambda-metricslib";
import {errorNotificationWrapper, sendErrorNotificaiton} from "giftbit-cassava-routes/dist/sentry";
import {SendEmailResponse} from "aws-sdk/clients/ses";
import {sendEmail} from "../../utils/emailUtils";
import {CreateCardParams} from "lightrail-client/dist/params";
import {GiftbitRestError} from "giftbit-cassava-routes/dist/GiftbitRestError";
import {Charge} from "../../utils/stripedtos/Charge";
import {StripeAuth} from "../../utils/stripedtos/StripeAuth";
import {StripeModeConfig} from "../../utils/stripedtos/StripeConfig";
import {formatCurrency} from "../../utils/currencyUtils";
import {getMinfraudParamsForGiftcardPurchase} from "../../utils/giftcardPurchaseFraudCheckUtils";
import {MinfraudConfig} from "../../utils/minfraud/MinfraudConfig";
import {getScore} from "../../utils/minfraud/minfraudUtils";
import {AuthorizationBadge} from "giftbit-cassava-routes/dist/jwtauth";
import {MinfraudScoreParams} from "../../utils/minfraud/MinfraudScoreParams";
import {MinfraudScoreResult} from "../../utils/minfraud/MinfraudScoreResult";
import {sendEvent} from "../../utils/eventUtils";

export const router = new cassava.Router();

router.route(new cassava.routes.LoggingRoute());

const authConfigPromise = giftbitRoutes.secureConfig.fetchFromS3ByEnvVar<any>("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_JWT");
const roleDefinitionsPromise = giftbitRoutes.secureConfig.fetchFromS3ByEnvVar<any>("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_ROLE_DEFINITIONS");
const assumeGetSharedSecretToken = giftbitRoutes.secureConfig.fetchFromS3ByEnvVar<giftbitRoutes.secureConfig.AssumeScopeToken>("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_ASSUME_STORAGE_SCOPE_TOKEN");
const assumeGiftcardPurchaseToken = giftbitRoutes.secureConfig.fetchFromS3ByEnvVar<giftbitRoutes.secureConfig.AssumeScopeToken>("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_ASSUME_GIFTCARD_PURCHASE_TOKEN");
const minfraudConfigPromise = giftbitRoutes.secureConfig.fetchFromS3ByEnvVar<MinfraudConfig>("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_MINFRAUD");
router.route(new giftbitRoutes.jwtauth.JwtAuthorizationRoute(authConfigPromise, roleDefinitionsPromise, `https://${process.env["LIGHTRAIL_DOMAIN"]}${process.env["PATH_TO_MERCHANT_SHARED_SECRET"]}`, assumeGetSharedSecretToken));
router.route("/v1/turnkey/purchaseGiftcard")
    .method("POST")
    .handler(async evt => {
        console.log("Received request:" + JSON.stringify(evt));
        const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
        metrics.histogram("turnkey.giftcardpurchase", 1, [`mode:${auth.isTestUser() ? "test" : "live"}`]);
        metrics.flush();
        auth.requireIds("giftbitUserId");
        auth.requireScopes("lightrailV1:purchaseGiftcard");

        const authorizeAs: string = evt.meta["auth-token"].split(".")[1];
        const assumeToken = (await assumeGiftcardPurchaseToken).assumeToken;

        lightrail.configure({
            apiKey: assumeToken,
            restRoot: "https://" + process.env["LIGHTRAIL_DOMAIN"] + "/v1/",
            logRequests: true,
            additionalHeaders: {AuthorizeAs: authorizeAs}
        });

        const {config, merchantStripeConfig, lightrailStripeConfig} = await validateConfig(auth, assumeToken, authorizeAs);
        const params = validateParams(evt);
        const chargeAndCardCoreMetadata = {
            sender_name: params.senderName,
            sender_email: params.senderEmail,
            recipient_email: params.recipientEmail
        };

        let charge: Charge = await createCharge({
            amount: params.initialValue,
            currency: config.currency,
            source: params.stripeCardToken,
            receipt_email: params.senderEmail,
            metadata: chargeAndCardCoreMetadata
        }, lightrailStripeConfig.secretKey, merchantStripeConfig.stripe_user_id);

        let card: Card;

        await doFraudCheck(lightrailStripeConfig, merchantStripeConfig, params, charge, evt, auth);

        try {
            const cardMetadata = {
                ...chargeAndCardCoreMetadata,
                charge_id: charge.id,
                "giftbit-note": {note: `charge_id: ${charge.id}, sender: ${params.senderEmail}, recipient: ${params.recipientEmail}`}
            };
            card = await createCard(charge.id, params, config, cardMetadata);
        } catch (err) {
            console.log(`An error occurred during card creation. Error: ${JSON.stringify(err)}.`);
            await rollback(lightrailStripeConfig, merchantStripeConfig, charge, card, 'Refunded due to an unexpected error during gift card creation in Lightrail.');

            if (err.status === 400) {
                throw new RestError(httpStatusCode.clientError.BAD_REQUEST, err.body.message);
            } else {
                throw new RestError(httpStatusCode.serverError.INTERNAL_SERVER_ERROR);
            }
        }

        try {
            await updateCharge(charge.id, {
                description: `${config.companyName} gift card. Purchase reference number: ${card.cardId}.`,
                metadata: {...chargeAndCardCoreMetadata, lightrail_gift_card_id: card.cardId}
            }, lightrailStripeConfig.secretKey, merchantStripeConfig.stripe_user_id);
            await emailGiftToRecipient({
                cardId: card.cardId,
                recipientEmail: params.recipientEmail,
                message: params.message,
                senderName: params.senderName,
                initialValue: params.initialValue
            }, config);
        } catch (err) {
            console.log(`An error occurred while attempting to deliver fullcode to recipient. Error: ${err}.`);
            await rollback(lightrailStripeConfig, merchantStripeConfig, charge, card, `Refunded due to an unexpected error during the gift card delivery step. The gift card ${card.cardId} will be cancelled in Lightrail.`);
            throw new GiftbitRestError(httpStatusCode.serverError.INTERNAL_SERVER_ERROR)
        }

        return {
            body: {
                cardId: card.cardId
            }
        };
    });

async function createCard(userSuppliedId: string, params: GiftcardPurchaseParams, config: TurnkeyPublicConfig, metadata?: any): Promise<Card> {
    const cardParams: CreateCardParams = {
        userSuppliedId: userSuppliedId,
        cardType: Card.CardType.GIFT_CARD,
        initialValue: params.initialValue,
        programId: config.programId,
        metadata: metadata
    };
    console.log(`Creating card with params ${JSON.stringify(cardParams)}.`);
    const card: Card = await lightrail.cards.createCard(cardParams);
    console.log(`Created card ${JSON.stringify(card)}.`);
    return Promise.resolve(card);
}

function validateStripeConfig(merchantStripeConfig: StripeAuth, lightrailStripeConfig: StripeModeConfig) {
    if (!merchantStripeConfig || !merchantStripeConfig.stripe_user_id) {
        throw new GiftbitRestError(424, "Merchant stripe config stripe_user_id must be set.", "MissingStripeUserId");
    }
    if (!lightrailStripeConfig || !lightrailStripeConfig.secretKey) {
        console.log("Lightrail stripe secretKey could not be loaded from s3 secure config.");
        throw new RestError(httpStatusCode.serverError.INTERNAL_SERVER_ERROR);
    }
}

async function emailGiftToRecipient(params: EmailGiftCardParams, turnkeyConfig: TurnkeyPublicConfig): Promise<SendEmailResponse> {
    const fullcode: string = (await lightrail.cards.getFullcode(params.cardId)).code;
    console.log(`retrieved fullcode lastFour ${fullcode.substring(fullcode.length - 4)}`);
    const claimLink = turnkeyConfig.claimLink.replace(FULLCODE_REPLACMENT_STRING, fullcode);
    const from = params.senderName ? `From ${params.senderName}` : "";
    const emailSubject = turnkeyConfig.emailSubject ? turnkeyConfig.emailSubject : `You have received a gift card for ${turnkeyConfig.companyName}`;
    params.message = params.message ? params.message : "Hi there, please enjoy this gift.";

    let emailTemplate = RECIPIENT_EMAIL;
    const templateReplacements = [
        {key: "fullcode", value: fullcode},
        {key: "claimLink", value: claimLink},
        {key: "senderFrom", value: from},
        {key: "emailSubject", value: emailSubject},
        {key: "message", value: params.message},
        {key: "initialValue", value: formatCurrency(params.initialValue, turnkeyConfig.currency)},
        {key: "additionalInfo", value: turnkeyConfig.additionalInfo || " "},
        {key: "claimLink", value: turnkeyConfig.claimLink},
        {key: "companyName", value: turnkeyConfig.companyName},
        {key: "companyWebsiteUrl", value: turnkeyConfig.companyWebsiteUrl},
        {key: "copyright", value: turnkeyConfig.copyright},
        {key: "copyrightYear", value: new Date().getUTCFullYear().toString()},
        {key: "customerSupportEmail", value: turnkeyConfig.customerSupportEmail},
        {key: "linkToPrivacy", value: turnkeyConfig.linkToPrivacy},
        {key: "linkToTerms", value: turnkeyConfig.linkToTerms},
        {key: "logo", value: turnkeyConfig.logo},
        {key: "termsAndConditions", value: turnkeyConfig.termsAndConditions},
    ];

    for (const replacement of templateReplacements) {
        const regexp = new RegExp(`__${replacement.key}__`, "g");
        emailTemplate = emailTemplate.replace(regexp, replacement.value);
    }

    const sendEmailResponse = await sendEmail({
        toAddress: params.recipientEmail,
        subject: emailSubject,
        body: emailTemplate,
        replyToAddress: turnkeyConfig.giftEmailReplyToAddress,
    });
    console.log(`Email sent. MessageId: ${sendEmailResponse.MessageId}.`);
    return Promise.resolve(sendEmailResponse);
}

//noinspection JSUnusedGlobalSymbols
export const handler = errorNotificationWrapper(
    process.env["SECURE_CONFIG_BUCKET"],        // the S3 bucket with the Sentry API key
    process.env["SECURE_CONFIG_KEY_SENTRY"],   // the S3 object key for the Sentry API key
    router,
    metrics.wrapLambdaHandler(
        process.env["SECURE_CONFIG_BUCKET"],        // the S3 bucket with the DataDog API key
        process.env["SECURE_CONFIG_KEY_DATADOG"],   // the S3 object key for the DataDog API key
        router.getLambdaHandler()                   // the cassava handler
    ));

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
        sendErrorNotificaiton(err);
        throw err
    }
}

function validateParams(request: RouterEvent): GiftcardPurchaseParams {
    const params = giftcardPurchaseParams.setParamsFromRequest(request);
    giftcardPurchaseParams.validateParams(params);
    return params
}

async function rollback(lightrailStripeConfig: StripeModeConfig, merchantStripeConfig: StripeAuth, charge: Charge, card: Card, reason: string): Promise<void> {
    const refund = await createRefund(charge.id, lightrailStripeConfig.secretKey, merchantStripeConfig.stripe_user_id, reason);
    console.log(`Refunded charge ${charge.id}. Refund: ${JSON.stringify(refund)}.`);
    if (card) {
        const cancel = await lightrail.cards.cancelCard(card, card.cardId + "-cancel");
        console.log(`Cancelled card ${card.cardId}. Cancel response: ${cancel}.`);
    }
}

async function doFraudCheck(lightrailStripeConfig: StripeModeConfig, merchantStripeConfig: StripeAuth, giftcardPurchaseParams: GiftcardPurchaseParams, charge: Charge, request: RouterEvent, auth: AuthorizationBadge): Promise<void> {
    const minfraudScoreParams: MinfraudScoreParams = getMinfraudParamsForGiftcardPurchase({
        request: request,
        charge: charge,
        userId: auth.merchantId,
        recipientEmail: giftcardPurchaseParams.recipientEmail,
        name: giftcardPurchaseParams.senderName
    });

    const passedStripeCheck = doStripeCheck(charge);
    let passedMinfraudCheck: boolean = true;
    let minfraudScore: MinfraudScoreResult;

    if (!auth.isTestUser()) {
        try {
            minfraudScore = await getScore(minfraudScoreParams, minfraudConfigPromise);
            if (minfraudScore.riskScore > 70 || minfraudScore.ipRiskScore > 70 /* The range is [0.1-99] and represents the likelihood of the purchase being fraudulent. 70 = 70% likely to be fraudulent. */) {
                console.log("Minfraud score above allowed range.");
                passedMinfraudCheck = false
            } else {
                console.log("Minfraud score was within allowed range.");
                passedMinfraudCheck = true
            }
        } catch (err) {
            console.log(`Unexpected error occurred during fraud check. Simply logging the exception and carrying on with request. ${err}`);
        }
    }

    const passedFraudCheck = passedStripeCheck && passedMinfraudCheck;
    await sendEvent("dropin.giftcard.purchase.fraudcheck", charge.id, {
        giftcardPurchaseParams: giftcardPurchaseParams,
        minfraudScoreParams: minfraudScoreParams,
        minfraudScore: minfraudScore,
        passedFraudCheck: passedFraudCheck
    });
    // sendEvent(giftCardPurchaseParams, fraudCheckParams, passedFraudCheck)
    if (!passedFraudCheck) {
        await rollback(lightrailStripeConfig, merchantStripeConfig, charge, null, 'The order failed fraud check.');
        throw new GiftbitRestError(httpStatusCode.clientError.BAD_REQUEST, "Failed to charge credit card.", "ChargeFailed");
    }
}

function doStripeCheck(charge: Charge): boolean {
    if (charge.review) {
        console.log(`Charge was flagged for a review in stripe. Will now refund.`);
        return false
    } else {
        return true
    }
}