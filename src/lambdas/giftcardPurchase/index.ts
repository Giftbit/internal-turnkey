import "babel-polyfill";
import * as cassava from "cassava";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as lightrail from "lightrail-client";
import {Card, Fullcode} from "lightrail-client/dist/model";
import * as aws from "aws-sdk";
import * as turnkeyConfigUtil from "../../utils/turnkeyConfigStore";
import * as giftcardPurchaseParams from "./GiftcardPurchaseParams";
import {GiftcardPurchaseParams} from "./GiftcardPurchaseParams";
import {RECIPIENT_EMAIL} from "./RecipientEmail";
import {TurnkeyPublicConfig} from "../../utils/TurnkeyPublicConfig";
import {TurnkeyConfig, validateTurnkeyConfig} from "../../utils/TurnkeyConfig";

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
        const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
        auth.requireIds("giftbitUserId");

        const secret: string = (await authConfigPromise).secretkey;
        auth.scopes = ["lightrailV1:card", "lightrailV1:program:show", "lightrailV1:turnkeyconfigprivate:show"]; // todo - scope for private turnkey config needs to be present
        auth.issuer = "CARD_PURCHASE_SERVICE";
        let jwt = auth.sign(secret);

        const config: TurnkeyConfig = await turnkeyConfigUtil.getConfig(jwt);
        console.log("Fetched config: " + JSON.stringify(config));
        validateTurnkeyConfig(config);
        console.log("Finished validating config!");

        const params = giftcardPurchaseParams.setParamsFromRequest(evt);
        giftcardPurchaseParams.validateParams(params);

        /* todo - uncomment and test
         const charge = await chargeCard(params, turnkeyConfigPublic.currency, turnkeyConfigPrivate.stripeSecret);
         if (!charge) {
         throw new RestError(httpStatusCode.clientError.BAD_REQUEST, "stripe charge failed.");
         }
         */

        lightrail.configure({
            apiKey: jwt,
            restRoot: "https://" + process.env["LIGHTRAIL_DOMAIN"] + "/v1/",
            logRequests: true
        });

        const card: Card = await lightrail.cards.createCard({
            userSuppliedId: params.stripeCardToken,
            programId: config.publicConfig.programId,
            cardType: Card.CardType.GIFT_CARD,
            initialValue: params.initialValue,
            metadata: {
                sender: {
                    name: params.senderName,
                    email: params.senderEmail,
                },
                recipient: {
                    email: params.recipientEmail
                },
                // charge: {
                //     charge: charge
                // }
            }
        });
        const fullcode: Fullcode = await lightrail.cards.getFullcode(card);
        // Step 3
        // email the recipient the fullcode
        // email contains: company name and redemption url (Stretch: logo). These are from turnkey config.
        emailGiftToRecipient(params, fullcode.code, config.publicConfig);

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
                domain: process.env["LIGHTRAIL_DOMAIN"],
                jwt: jwt,
                card: card,
                fullcode: fullcode,
                turnkeyConfig: config
            }
        };
    });

async function chargeCard(requestParams: GiftcardPurchaseParams, currency: string, stripeSecret: string): Promise<any> {
    const stripe = require("stripe")(stripeSecret);

    // Charge the user's card:
    return stripe.charges.create({
        amount: requestParams.initialValue,
        currency: currency,
        description: `Charge for gift card. userSuppliedId = ${requestParams.stripeCardToken}.`,
        source: requestParams.stripeCardToken,
    }, function (err, charge) {
        if (err) {
            console.log(err)
        } else {
            console.log(`Credit card with token ${requestParams.stripeCardToken} has been charged ${requestParams.initialValue} ${currency}. Resulting charge ${charge}.`)
            return charge
        }
    });
}

async function emailGiftToRecipient(params: GiftcardPurchaseParams, fullcode: string, publicConfig: TurnkeyPublicConfig) {
    let emailTemplate = RECIPIENT_EMAIL;
    emailTemplate = emailTemplate.replace("{{message}}", params.message);
    emailTemplate = emailTemplate.replace("{{fullcode}}", fullcode);
    emailTemplate = emailTemplate.replace("{{companyName}}", publicConfig.companyName);
    emailTemplate = emailTemplate.replace("{{logo}}", publicConfig.logo);
    emailTemplate = emailTemplate.replace("{{termsAndConditions}}", publicConfig.termsAndConditions);


    const eParams = {
        Destination: {
            ToAddresses: ["tim+123@giftbit.com"]
        },
        Message: {
            Body: {
                Html: {
                    Data: emailTemplate
                }
            },
            Subject: {
                Data: "Email Subject!!!"
            }
        },
        Source: "tim@giftbit.com"
    };

    console.log('===SENDING EMAIL===');
    let email = await ses.sendEmail(eParams, function (err, data) {
        if (err) console.log(err);
        else {
            console.log("===EMAIL SENT===");
            console.log(data);

            console.log("EMAIL CODE END");
            console.log('EMAIL: ', email);
            return data
        }
    });
}

//noinspection JSUnusedGlobalSymbols
export const handler = router.getLambdaHandler();