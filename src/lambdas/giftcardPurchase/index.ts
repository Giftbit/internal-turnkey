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
import * as stripeAccess from "../stripe/stripeAccess";
import {EmailGiftCardParams} from "./EmailGiftCardParams";
import {createCharge, createRefund, setCardDetailsOnCharge} from "./stripeRequests";
import * as metrics from "giftbit-lambda-metricslib";
import {errorNotificationWrapper} from "giftbit-cassava-routes/dist/sentry";
import {SendEmailResponse} from "aws-sdk/clients/ses";
import {sendEmail} from "../../utils/emailUtils";
import {CreateCardParams} from "lightrail-client/dist/params";
import {GiftbitRestError} from "giftbit-cassava-routes/dist/GiftbitRestError";
import {Charge} from "../../utils/stripedtos/Charge";
import {StripeAuth} from "../../utils/stripedtos/StripeAuth";
import {StripeConfig} from "../../utils/stripedtos/StripeConfig";

export const router = new cassava.Router();

router.route(new cassava.routes.LoggingRoute());

const authConfigPromise = giftbitRoutes.secureConfig.fetchFromS3ByEnvVar<any>("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_JWT");
const roleDefinitionsPromise = giftbitRoutes.secureConfig.fetchFromS3ByEnvVar<any>("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_ROLE_DEFINITIONS");
const assumeGetSharedSecretToken = giftbitRoutes.secureConfig.fetchFromS3ByEnvVar<giftbitRoutes.secureConfig.AssumeScopeToken>("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_ASSUME_STORAGE_SCOPE_TOKEN");
const assumeGiftcardPurchaseToken = giftbitRoutes.secureConfig.fetchFromS3ByEnvVar<giftbitRoutes.secureConfig.AssumeScopeToken>("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_ASSUME_GIFTCARD_PURCHASE_TOKEN");
router.route(new giftbitRoutes.jwtauth.JwtAuthorizationRoute(authConfigPromise, roleDefinitionsPromise, `https://${process.env["LIGHTRAIL_DOMAIN"]}${process.env["PATH_TO_MERCHANT_SHARED_SECRET"]}`, assumeGetSharedSecretToken));
router.route("/v1/turnkey/purchaseGiftcard")
    .method("POST")
    .handler(async evt => {
        console.log("Received request:" + JSON.stringify(evt));
        metrics.histogram("turnkey.giftcardpurchase", 1, ["type:requested"]);
        metrics.flush();
        const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
        auth.requireIds("giftbitUserId");
        auth.requireScopes("lightrailV1:purchaseGiftcard");
        const authorizeAs: string = evt.meta["auth-token"].split(".",)[1];
        const assumeToken = (await assumeGiftcardPurchaseToken).assumeToken;

        lightrail.configure({
            apiKey: assumeToken,
            restRoot: "https://" + process.env["LIGHTRAIL_DOMAIN"] + "/v1/",
            logRequests: true,
            additionalHeaders: {AuthorizeAs: authorizeAs}
        });

        const {config, merchantStripeConfig, lightrailStripeConfig, params} = await validateConfigAndParams(assumeToken, authorizeAs, evt);

        let charge: Charge = await createCharge({
            amount: params.initialValue,
            currency: config.currency,
            source: params.stripeCardToken
        }, lightrailStripeConfig.secretKey, merchantStripeConfig.stripe_user_id);

        let card: Card;
        try {
            card = await createCard(charge, params, config);
        } catch (err) {
            console.log(`An error occurred during card creation. Error: ${JSON.stringify(err)}.`);
            await rollback(lightrailStripeConfig, merchantStripeConfig, charge, card);

            if (err.status == 400) {
                throw new RestError(httpStatusCode.clientError.BAD_REQUEST, err.body.message)
            } else {
                throw new RestError(httpStatusCode.serverError.INTERNAL_SERVER_ERROR)
            }
        }

        try {
            await setCardDetailsOnCharge(charge.id, {description: `${config.companyName} gift card. Purchase reference number: ${card.cardId}.`}, lightrailStripeConfig.secretKey, merchantStripeConfig.stripe_user_id);
            await emailGiftToRecipient({
                cardId: card.cardId,
                recipientEmail: params.recipientEmail,
                message: params.message
            }, config);
        } catch (err) {
            console.log(`An error occurred while attempting to deliver fullcode to recipient. Error: ${err}.`);
            await rollback(lightrailStripeConfig, merchantStripeConfig, charge, card);
        }

        metrics.histogram("turnkey.giftcardpurchase", 1, ["type:succeeded"]);
        metrics.flush();
        return {
            body: {
                cardId: card.cardId
            }
        };
    });

async function createCard(charge, params: GiftcardPurchaseParams, config: TurnkeyPublicConfig): Promise<Card> {
    const cardParams: CreateCardParams = {
        userSuppliedId: charge.id,
        cardType: Card.CardType.GIFT_CARD,
        initialValue: params.initialValue,
        programId: config.programId,
        metadata: {
            sender: {
                name: params.senderName,
                email: params.senderEmail,
            },
            recipient: {
                email: params.recipientEmail
            },
            charge: {
                chargeId: charge.id,
            }
        }
    };
    console.log(`Creating card with params ${JSON.stringify(cardParams)}.`);
    const card: Card = await lightrail.cards.createCard(cardParams);
    console.log(`Created card ${JSON.stringify(card)}.`);
    return Promise.resolve(card)
}

function validateStripeConfig(merchantStripeConfig: StripeAuth, lightrailStripeConfig: StripeConfig) {
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
    let claimLink = turnkeyConfig.claimLink.replace(FULLCODE_REPLACMENT_STRING, fullcode);

    let emailTemplate = RECIPIENT_EMAIL;
    emailTemplate = emailTemplate.replace("{{message}}", params.message);
    emailTemplate = emailTemplate.replace("{{fullcode}}", fullcode);
    emailTemplate = emailTemplate.replace("{{companyName}}", turnkeyConfig.companyName);
    emailTemplate = emailTemplate.replace("{{logo}}", turnkeyConfig.logo);
    emailTemplate = emailTemplate.replace("{{claimLink}}", claimLink);
    emailTemplate = emailTemplate.replace("{{termsAndConditions}}", turnkeyConfig.termsAndConditions);

    const sendEmailResponse = await sendEmail({
        toAddress: params.recipientEmail,
        subject: `You have received a gift card for ${turnkeyConfig.companyName}`,
        body: emailTemplate,
        replyToAddress: turnkeyConfig.giftEmailReplyToAddress,
    });
    console.log(`Email sent. MessageId: ${sendEmailResponse.MessageId}.`);
    return Promise.resolve(sendEmailResponse)
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

async function validateConfigAndParams(assumeToken: string, authorizeAs: string, request: RouterEvent): Promise<{ config: TurnkeyPublicConfig, merchantStripeConfig: StripeAuth, lightrailStripeConfig: StripeConfig, params: GiftcardPurchaseParams }> {
    const config: TurnkeyPublicConfig = await turnkeyConfigUtil.getConfig(assumeToken, authorizeAs);
    console.log(`Fetched public turnkey config: ${JSON.stringify(config)}`);
    validateTurnkeyConfig(config);

    const merchantStripeConfig: StripeAuth = await kvsAccess.kvsGet(assumeToken, "stripeAuth", authorizeAs);
    const lightrailStripeConfig: StripeConfig = await stripeAccess.getStripeConfig();
    validateStripeConfig(merchantStripeConfig, lightrailStripeConfig);

    const params = giftcardPurchaseParams.setParamsFromRequest(request);
    giftcardPurchaseParams.validateParams(params);
    return Promise.resolve({config, merchantStripeConfig, lightrailStripeConfig, params})
}

async function rollback(lightrailStripeConfig: StripeConfig, merchantStripeConfig: StripeAuth, charge: Charge, card?: Card): Promise<void> {
    const refund = await createRefund(charge.id, lightrailStripeConfig.secretKey, merchantStripeConfig.stripe_user_id);
    console.log(`Refunded charge ${charge.id}. Refund: ${JSON.stringify(refund)}.`);
    if (card) {
        const cancel = await lightrail.cards.cancelCard(card, card.cardId + "-cancel");
        console.log(`Cancelled card ${card.cardId}. Cancel response: ${cancel}.`);
    }
}