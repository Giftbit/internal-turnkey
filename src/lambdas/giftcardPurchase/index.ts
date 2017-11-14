import "babel-polyfill";
import * as cassava from "cassava";
import {httpStatusCode, RestError} from "cassava";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as lightrail from "lightrail-client";
import {Card} from "lightrail-client/dist/model";
import * as aws from "aws-sdk";
import * as turnkeyConfigUtil from "../../utils/turnkeyConfigStore";
import * as giftcardPurchaseParams from "./GiftcardPurchaseParams";
import {RECIPIENT_EMAIL} from "./RecipientEmail";
import {FULLCODE_REPLACMENT_STRING, TurnkeyPublicConfig, validateTurnkeyConfig} from "../../utils/TurnkeyConfig";
import * as kvsAccess from "../../utils/kvsAccess";
import {StripeAuth} from "../stripe/StripeAuth";
import * as stripeAccess from "../stripe/stripeAccess";
import {EmailGiftCardParams} from "./EmailGiftCardParams";
import {StripeConfig} from "../stripe/StripeConfig";
import {createCharge, createRefund, updateCharge} from "./stripeRequests";
import {Charge} from "./Charge";
import * as metrics from "giftbit-lambda-metricslib";
import {errorNotificationWrapper} from "giftbit-cassava-routes/dist/sentry";

const ses = new aws.SES({region: 'us-west-2'});

export const router = new cassava.Router();

router.route(new cassava.routes.LoggingRoute());

const authConfigPromise = giftbitRoutes.secureConfig.fetchFromS3ByEnvVar<any>("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_JWT");
const roleDefinitionsPromise = giftbitRoutes.secureConfig.fetchFromS3ByEnvVar<any>("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_ROLE_DEFINITIONS");
router.route(new giftbitRoutes.jwtauth.JwtAuthorizationRoute(authConfigPromise, roleDefinitionsPromise));

// todo - this should require a specific scope.
router.route("/v1/turnkey/purchaseGiftcard")
    .method("POST")
    .handler(async evt => {
        metrics.histogram("turnkey.giftcardpurchase", 1, ["type:requested"]);
        metrics.flush();
        console.log("evt:" + JSON.stringify(evt));
        const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
        auth.requireIds("giftbitUserId");
        // auth.requireScopes("lightrailV1:externalPurchaseGiftCard"); // todo - this needs to be added back in once the shopper token is being created.
        const jwt: string = await getJwtForLightrailRequests(auth);

        lightrail.configure({
            apiKey: jwt,
            restRoot: "https://" + process.env["LIGHTRAIL_DOMAIN"] + "/v1/",
            logRequests: true
        });

        const config: TurnkeyPublicConfig = await turnkeyConfigUtil.getConfig(jwt);
        validateTurnkeyConfig(config);
        console.log(`Fetched public turnkey config: ${JSON.stringify(config)}`);

        const merchantStripeConfig: StripeAuth = await kvsAccess.kvsGet(jwt, "stripeAuth");
        const lightrailStripeConfig: StripeConfig = await stripeAccess.getStripeConfig();
        validateStripeConfig(merchantStripeConfig, lightrailStripeConfig);

        const params = giftcardPurchaseParams.setParamsFromRequest(evt);
        giftcardPurchaseParams.validateParams(params);

        let charge: Charge;
        let card: Card;

        try {
            charge = await createCharge(params, config.currency, lightrailStripeConfig.secretKey, merchantStripeConfig.stripe_user_id);
            console.log(`created charge ${JSON.stringify(charge)}`);
        } catch (err) {
            console.log(`error creating charge. err: ${err}`);
            switch (err.type) {
                case 'StripeCardError':
                    throw new RestError(httpStatusCode.clientError.BAD_REQUEST, "charge failed");
                case 'StripeInvalidRequestError':
                    throw new RestError(httpStatusCode.clientError.BAD_REQUEST, "invalid stripeCardToken");
                case 'RateLimitError':
                    throw new RestError(httpStatusCode.clientError.TOO_MANY_REQUESTS, `service was rate limited by dependent service`);
                default:
                    throw new Error(`an unexpected error occurred while attempting to charge card. error ${err}`);
            }
        }

        try {
            card = await lightrail.cards.createCard({
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
            });
            console.log(`created card ${JSON.stringify(card)}`);
        } catch (err) {
            console.log(`An error occurred during card creation. Error: ${JSON.stringify(err)}`);
            const refund = await createRefund(charge, lightrailStripeConfig.secretKey, merchantStripeConfig.stripe_user_id);
            console.log(`Refunded charge ${charge.id}. Refund: ${JSON.stringify(refund)}`);

            if (err.status == 400) {
                throw new RestError(httpStatusCode.clientError.BAD_REQUEST, err.body.message)
            } else {
                throw new RestError(httpStatusCode.serverError.INTERNAL_SERVER_ERROR, "something unexpected occurred during card creation")
            }
        }

        try {
            const chargeUpdateParams = {
                description: `${config.companyName} gift card. Purchase reference number: ${card.cardId}.`,
                metadata: {
                    cardId: card.cardId,
                }
            };

            const chargeUpdate = updateCharge(charge.id, chargeUpdateParams, lightrailStripeConfig.secretKey, merchantStripeConfig.stripe_user_id);
            console.log(`updated charge ${JSON.stringify(chargeUpdate)}`);

            const emailResult = await emailGiftToRecipient({
                cardId: card.cardId,
                recipientEmail: params.recipientEmail,
                message: params.message
            }, config);
            console.log(`sent email ${emailResult.messageId}`);
        } catch (err) {
            console.log(`An error occurred while attempting to deliver fullcode to recipient. Error: ${err}`);
            const refund = await createRefund(charge, lightrailStripeConfig.secretKey, merchantStripeConfig.stripe_user_id);
            console.log(`refunded charge ${charge.id}. refund: ${JSON.stringify(refund)}`);
            const cancel = await lightrail.cards.cancelCard(card, card.cardId + "-cancel");
            console.log(`cancelled card ${card.cardId}. cancel response: ${cancel}`);
        }
        metrics.histogram("turnkey.giftcardpurchase", 1, ["type:succeeded"]);
        metrics.flush();
        return {
            body: {
                cardId: card.cardId
            }
        };
    });

function validateStripeConfig(merchantStripeConfig: StripeAuth, lightrailStripeConfig: StripeConfig) {
    if (!merchantStripeConfig || !merchantStripeConfig.stripe_user_id) {
        throw new RestError(424, "merchant stripe config stripe_user_id cannot be null");
    }
    if (!lightrailStripeConfig || !lightrailStripeConfig.secretKey) {
        console.log("Lightrail stripe secretKey could not be loaded from s3 secure config.");
        throw new RestError(httpStatusCode.serverError.INTERNAL_SERVER_ERROR, "internal server error");
    }
}

async function emailGiftToRecipient(params: EmailGiftCardParams, turnkeyConfig: TurnkeyPublicConfig): Promise<any> {
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

    const eParams = {
        Destination: {
            ToAddresses: [params.recipientEmail]
        },
        Message: {
            Body: {
                Html: {
                    Data: emailTemplate
                }
            },
            Subject: {
                Data: `You have received a gift card for ${turnkeyConfig.companyName}`
            }
        },
        Source: "tim@giftbit.com"
    };

    console.log('===SENDING EMAIL===');
    return ses.sendEmail(eParams).promise();
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

async function getJwtForLightrailRequests(auth: giftbitRoutes.jwtauth.AuthorizationBadge): Promise<string> {
    const secret: string = (await authConfigPromise).secretkey;
    auth.scopes = ["lightrailV1:card", "lightrailV1:program:show"]; // todo - scope for private turnkey config needs to be set
    auth.issuer = "CARD_PURCHASE_SERVICE";
    return auth.sign(secret);
}