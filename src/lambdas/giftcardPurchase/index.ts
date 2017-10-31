import "babel-polyfill";
import * as cassava from "cassava";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as lightrail from "lightrail-client";
import {Card, Fullcode} from "lightrail-client/dist/model";
import * as aws from "aws-sdk";
import * as turnkeyConfigUtil from "../../utils/turnkeyConfigStore";
import {TurnkeyPrivateConfig, validatePrivateTurnkeyConfig} from "../../utils/TurnkeyPrivateConfig";
import * as giftcardPurchaseParams from "./GiftcardPurchaseParams";
import {GiftcardPurchaseParams} from "./GiftcardPurchaseParams";
import {RECIPIENT_EMAIL} from "./RecipientEmail";
import {TurnkeyPublicConfig, validatePublicTurnkeyConfig} from "../../utils/TurnkeyPublicConfig";

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

        // let newBadge = new AuthorizationBadge();
        // newBadge.giftbitUserId = auth.giftbitUserId;
        // newBadge.merchantId = auth.merchantId;
        // newBadge.teamMemberId = auth.teamMemberId;
        // newBadge.issuer = "CARD_PURCHASE_SERVICE";
        // newBadge.scopes = ["lightrailV1:card", "lightrailV1:program:show"];
        // const secret: string = (await authConfigPromise).secretkey;
        // let jwt = newBadge.sign(secret);//newBadge.sign(secret);

        const secret: string = (await authConfigPromise).secretkey;
        auth.scopes = ["lightrailV1:card", "lightrailV1:program:show", "lightrailV1:turnkeyprivate:show"]; // todo - scope for private turnkey config needs to be present
        auth.issuer = "CARD_PURCHASE_SERVICE";
        let jwt = auth.sign(secret);

        const turnkeyConfigPublic: TurnkeyPublicConfig = await turnkeyConfigUtil.getPublicConfig(jwt);
        validatePublicTurnkeyConfig(turnkeyConfigPublic);
        const turnkeyConfigPrivate: TurnkeyPrivateConfig = await turnkeyConfigUtil.getPrivateConfig(jwt);
        validatePrivateTurnkeyConfig(turnkeyConfigPrivate);

        const params = giftcardPurchaseParams.setParamsFromRequest(evt);
        giftcardPurchaseParams.validateParams(params);
        const userSuppliedId = Date.now().toFixed(); // todo - consider using the id of the Stripe Charge object. This is unique.



        // Step 1
        // fetch user's stripe token
        // charge user's customer using CC card token passed in request
        lightrail.configure({
            apiKey: jwt,
            restRoot: "https://" + process.env["LIGHTRAIL_DOMAIN"] + "/v1/",
            logRequests: true
        });

        // interesting, can't assign a contact to this card. Neither the sender, nor the recipient make sense to be added.
        // -> recipient: poppy will need to apply the gift card to an account w/ recipientEmail, but the userSuppliedId must = poppy's rocketship customer id.
        // -> sender: thomas may or may not have an account. Could lookup Thomas by email. If there is a contact, attach, otherwise, don't create one since you don't know thomas's rocketship customer id.
        const card: Card = await lightrail.cards.createCard({
            userSuppliedId: userSuppliedId,
            currency: params.currency,
            cardType: Card.CardType.GIFT_CARD,
            initialValue: params.initialValue,
            metadata: {
                sender: {
                    name: params.senderName,
                    email: params.senderEmail,
                },
                recipient: {
                    email: params.recipientEmail
                }
            }
        });
        const fullcode: Fullcode = await lightrail.cards.getFullcode(card);
        // Step 3
        // email the recipient the fullcode
        // email contains: company name and redemption url (Stretch: logo). These are from turnkey config.
        emailGiftToRecipient(params, fullcode.code, turnkeyConfigPublic);

        // todo - doesn't seem like sendTemplatedEmail works with the most reason version of the aws-sdk. The function seems to exist but results in TypeError: ses.sendTemplatedEmail is not a function. Possible that this is a really bad permission error.
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
                turnkeyConfig: turnkeyConfigPublic
            }
        };
    });

async function emailGiftToRecipient(params: GiftcardPurchaseParams, fullcode: string, config: TurnkeyPublicConfig) {
    let emailTemplate = RECIPIENT_EMAIL;
    emailTemplate = emailTemplate.replace("{{message}}", params.message);
    emailTemplate = emailTemplate.replace("{{fullcode}}", fullcode);
    emailTemplate = emailTemplate.replace("{{companyName}}", config.companyName);
    emailTemplate = emailTemplate.replace("{{logo}}", config.logo);
    emailTemplate = emailTemplate.replace("{{termsAndConditions}}", config.termsAndConditions);


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
        }
    });
}

//noinspection JSUnusedGlobalSymbols
export const handler = router.getLambdaHandler();

// async function createInactiveCard(jwt: string, initialValue: number): Promise<lightrail.model.Card> {
//
// }