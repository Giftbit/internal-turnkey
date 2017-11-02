import "babel-polyfill";
import * as cassava from "cassava";
import {httpStatusCode, RestError} from "cassava";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as lightrail from "lightrail-client";
import {Card, Fullcode} from "lightrail-client/dist/model";
import * as aws from "aws-sdk";
import * as turnkeyConfigUtil from "../../utils/turnkeyConfigStore";
import * as giftcardPurchaseParams from "./GiftcardPurchaseParams";
import {RECIPIENT_EMAIL} from "./RecipientEmail";
import {TurnkeyConfig, validateTurnkeyConfig} from "../../utils/TurnkeyConfig";
import * as kvsAccess from "../../utils/kvsAccess";
import {StripeAuth} from "../stripe/StripeAuth";
import * as stripeAccess from "../stripe/stripeAccess";
import {EmailGiftCardParams} from "./EmailGiftCardParams";
import {StripeConfig} from "../stripe/StripeConfig";
import {createChargeOnBehalfOfMerchant, retrieveTransfer, updateCharge} from "./stripeRequests";


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
        console.log("evt:" + JSON.stringify(evt));
        const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
        auth.requireIds("giftbitUserId");

        const secret: string = (await authConfigPromise).secretkey;
        auth.scopes = ["lightrailV1:card", "lightrailV1:program:show", "lightrailV1:turnkeyconfigprivate:show"]; // todo - scope for private turnkey config needs to be present
        auth.issuer = "CARD_PURCHASE_SERVICE";
        let jwt = auth.sign(secret);

        const config: TurnkeyConfig = await turnkeyConfigUtil.getConfig(jwt);
        console.log("Fetched config: " + JSON.stringify(config));
        validateTurnkeyConfig(config);

        const merchantStripeConfig: StripeAuth = await kvsAccess.kvsGet(jwt, "stripeAuth");
        const lightrailStripeConfig: StripeConfig = await stripeAccess.getStripeConfig();
        validateStripeConfig(merchantStripeConfig, lightrailStripeConfig);

        const params = giftcardPurchaseParams.setParamsFromRequest(evt);
        giftcardPurchaseParams.validateParams(params);

        let charge = await createChargeOnBehalfOfMerchant(params, config.currency, lightrailStripeConfig.secretKey, merchantStripeConfig.stripe_user_id);
        let transfer = await retrieveTransfer(charge, lightrailStripeConfig.secretKey);
        const paymentIdInMerchantStripeAccount = transfer.destination_payment;

        lightrail.configure({
            apiKey: jwt,
            restRoot: "https://" + process.env["LIGHTRAIL_DOMAIN"] + "/v1/",
            logRequests: true
        });

        console.log("Attempting to create card.");
        const card: Card = await lightrail.cards.createCard({
            userSuppliedId: paymentIdInMerchantStripeAccount,
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
                    charge: charge,
                    transfer: transfer
                }
            }
        });

        const chargeUpdate = await updateCharge(paymentIdInMerchantStripeAccount, card, merchantStripeConfig.access_token);
        console.log("ChargeUpdate: " + JSON.stringify(chargeUpdate));

        const fullcode: Fullcode = await lightrail.cards.getFullcode(card);

        try {
            const emailResult = await emailGiftToRecipient({
                fullcode: fullcode.code,
                recipientEmail: params.recipientEmail,
                message: params.message
            }, config);
            console.log("email result: " + emailResult);
        } catch (err) {

        }

        // working refund code
        // const refund = await createRefund(charge, lightrailStripeConfig.secretKey);
        // console.log("refund here: " + JSON.stringify(refund));
        // todo - doesn't seem like sendTemplatedEmail works with the most recent version of the aws-sdk. The function seems to exist but results in TypeError: ses.sendTemplatedEmail is not a function. Possible that this is a really bad permission error.
        // const eTemplateParams: SendTemplatedEmailRequest = {
        //     "Source": "tim@giftbit.com",
        //     "Template": "MyTemplate",
        //     "Destination": {
        //         "ToAddresses": ["tim+12345@giftbit.com"]
        //     },
        //     "TemplateData": "{ \"name\":\"Alejandro\", \"favoriteanimal\": \"horse\" }"
        // };
        //
        // console.log("===SENDING TEMPLATED EMAIL===");
        // let templatedEmail = await ses.sendTemplatedEmail(eTemplateParams, function (err, data) {
        //     if (err) console.log(err);
        //     else {
        //         console.log("===EMAIL SENT===");
        //         console.log(data);
        //
        //         console.log("EMAIL CODE END");
        //         console.log('EMAIL: ', templatedEmail);
        //     }
        // });

        return {
            body: {
                card: card,
                fullcode: fullcode,
                charge: charge,
                chargeUpdate: chargeUpdate,
            }
        };
    });

function validateStripeConfig(merchantStripeConfig: StripeAuth, lightrailStripeConfig: StripeConfig) {
    if (!merchantStripeConfig.access_token) {
        throw new RestError(httpStatusCode.serverError.INTERNAL_SERVER_ERROR, "merchant stripe config access_token cannot be null.");
    }
    if (!merchantStripeConfig.stripe_user_id) {
        throw new RestError(httpStatusCode.serverError.INTERNAL_SERVER_ERROR, "merchant stripe config stripe_user_id cannot be null.");
    }
    if (!lightrailStripeConfig.secretKey) {
        throw new RestError(httpStatusCode.serverError.INTERNAL_SERVER_ERROR, "lightrail stripe config secretKey cannot be null.");
    }
}


async function emailGiftToRecipient(params: EmailGiftCardParams, turnkeyConfig: TurnkeyConfig): Promise<any> {
    let emailTemplate = RECIPIENT_EMAIL;
    emailTemplate = emailTemplate.replace("{{message}}", params.message);
    emailTemplate = emailTemplate.replace("{{fullcode}}", params.fullcode);
    emailTemplate = emailTemplate.replace("{{companyName}}", turnkeyConfig.companyName);
    emailTemplate = emailTemplate.replace("{{logo}}", turnkeyConfig.logo);
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
    // console.log('===SENDING EMAIL===');
    // let email = await ses.sendEmail(eParams, function (err, data) {
    //     if (err) console.log(err);
    //     else {
    //         console.log("===EMAIL SENT===");
    //         console.log(data);
    //
    //         console.log("EMAIL CODE END");
    //         console.log('EMAIL: ', email);
    //         return data
    //     }
    // });
}

//noinspection JSUnusedGlobalSymbols
export const handler = router.getLambdaHandler();