import "babel-polyfill";
import * as cassava from "cassava";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as lightrail from "lightrail-client";
import {Card} from "lightrail-client/dist/model";
import * as aws from "aws-sdk";
import * as storageUtil from "../../utils/storageUtils";
import * as turnkeyConfigUtil from "../../utils/turnkeyConfigStore";
import {TurnkeyPublicConfig} from "../../utils/TurnkeyPublicConfig";
import {TurnkeyPrivateConfig} from "../../utils/TurnkeyPrivateConfig";
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


        const programId = await storageUtil.getKey("turnkey_program_id", jwt);
        console.log(programId);

        const turnkeyConfigPublic: TurnkeyPublicConfig = await turnkeyConfigUtil.getPublicConfig(jwt);
        const turnkeyConfigPrivate: TurnkeyPrivateConfig = await turnkeyConfigUtil.getPrivateConfig(jwt);

        if (!turnkeyConfigPublic.companyLogo || !turnkeyConfigPublic.companyName || !turnkeyConfigPublic.programId || !turnkeyConfigPrivate.stripeSecret) {
            console.log(`Turnkey config missing. TurnkeyPublicConfig: companyLogo = ${turnkeyConfigPublic.companyLogo}, companyName = ${turnkeyConfigPublic.companyName}, programId = ${turnkeyConfigPublic.programId}. TurnkeyPrivateConfig: stripeSecret = ${turnkeyConfigPrivate.stripeSecret != null ? "set" : "null"}.`);
            throw new cassava.RestError(cassava.httpStatusCode.serverError.INTERNAL_SERVER_ERROR, "turn key is missing config")
        }

        console.log(turnkeyConfigPublic);
        console.log("logo: " + turnkeyConfigPublic.companyLogo);

        const stripeCardToken: string = evt.body.stripeCardToken;
        const userSuppliedId = Date.now().toFixed(); // todo consider using the id of the Stripe Charge object. This is unique.
        const initialValue: number = evt.body.initialValue;
        const currency: string = evt.body.currency;
        const senderName: string = evt.body.senderName;
        const recipientEmail: string = evt.body.recipientEmail;
        const sendEmail: string = evt.body.sendEmail;
        const message: string = evt.body.message;

        if (!stripeCardToken) {
            throw new cassava.RestError(cassava.httpStatusCode.clientError.BAD_REQUEST, "parameter stripeCardToken cannot be null");
        }
        if (!currency) {
            throw new cassava.RestError(cassava.httpStatusCode.clientError.BAD_REQUEST, "parameter currency cannot be null");
        }
        if (!initialValue || initialValue <= 0) {
            throw new cassava.RestError(cassava.httpStatusCode.clientError.BAD_REQUEST, "parameter initialValue must be a positive integer");
        }

        // Step 1
        // fetch user's stripe token
        // charge user's customer using CC card token passed in request

        // Step 2
        // issue GIFT_CARD in Lightrail. (Stretch: Attach customer's contact info so that they can be notified when the recipient redeems the gift?)
        // retrieve fullcode

        const rootUrl: string = "https://" + process.env["LIGHTRAIL_DOMAIN"] + "/v1/";

        lightrail.configure({apiKey: jwt, restRoot: rootUrl, logRequests: true});
        console.log("configured lightrail client. root: " + rootUrl + " jwt: " + jwt);
        let card = lightrail.cards.createCard({
            userSuppliedId: userSuppliedId,
            currency: currency,
            cardType: Card.CardType.GIFT_CARD,
            initialValue: initialValue
        });
        console.log("here!");
        const cardObject: Card = await card;

        let fullcodePromise = lightrail.cards.getFullcode(cardObject);
        const fullcode = (await fullcodePromise).code;

        // Step 3
        // email the recipient the fullcode
        // email contains: company name and redemption url (Stretch: logo). These are from turnkey config.
        let emailTemplate = `
        <!DOCTYPE html>
        <html xmlns="http://www.w3.org/1999/xhtml">
        <head>
            <meta charset="utf-8" />
            <title></title>
        </head>
        <body>
            <img src="https://cdn.shopify.com/s/files/1/0067/1212/products/rocketship-pin_8152af72-0837-42ba-9467-c467d1530b7d_large.jpg?v=1480271948" alt="Smiley face" width="42" height="42">
            <p>
                {{message}}
            </p>
            <p>
                Redeem it <a href="www.google.com" target="_blank">here</a>!
            </p>
            <p>{{fullcode}}</p>
        </body>
        </html>
        `;
        emailTemplate = emailTemplate.replace("{{message}}", message);
        emailTemplate = emailTemplate.replace("{{fullcode}}", fullcode);

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


        return {
            body: {
                domain: process.env["LIGHTRAIL_DOMAIN"],
                jwt: jwt,
                card: cardObject,
                fullcode: fullcode,
                programId: programId,
                turnkeyConfig: turnkeyConfigPublic
            }
        };
    });

//noinspection JSUnusedGlobalSymbols
export const handler = router.getLambdaHandler();

// async function createInactiveCard(jwt: string, initialValue: number): Promise<lightrail.model.Card> {
//
// }