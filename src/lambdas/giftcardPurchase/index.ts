import "babel-polyfill";
import * as cassava from "cassava";
import * as giftbitRoutes from "giftbit-cassava-routes";
import {AuthorizationBadge} from "giftbit-cassava-routes/dist/jwtauth";
import * as lightrail from "lightrail-client";
import {Card} from "lightrail-client/dist/model";
import * as aws from "aws-sdk";
const ses = new aws.SES({region: 'us-west-2'});

export const router = new cassava.Router();

router.route(new cassava.routes.LoggingRoute());

const authConfigPromise = giftbitRoutes.secureConfig.fetchFromS3ByEnvVar<any>("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_JWT");
const roleDefinitionsPromise = giftbitRoutes.secureConfig.fetchFromS3ByEnvVar<any>("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_ROLE_DEFINITIONS");
router.route(new giftbitRoutes.jwtauth.JwtAuthorizationRoute(authConfigPromise, roleDefinitionsPromise));

router.route("/v1/turnkey/purchaseGiftcard")
    .method("POST")
    .handler(async evt => {
        const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
        auth.requireIds("giftbitUserId");


        const stripeCardToken: string = evt.body.stripeCardToken;
        const userSuppliedId = Date.now().toFixed(); // todo:tim consider using the id of the Stripe Charge object. This is unique.
        const initialValue: number = evt.body.initialValue;
        const currency: string = evt.body.currency;
        const recipientEmail: string = evt.body.recipientEmail;
        const sendEmail: string = evt.body.sendEmail;

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
        let newBadge = new AuthorizationBadge();
        newBadge.giftbitUserId = auth.giftbitUserId;
        newBadge.merchantId = auth.merchantId;
        newBadge.teamMemberId = auth.teamMemberId;
        newBadge.issuer = "CARD_PURCHASE_SERVICE";
        newBadge.scopes = ["lightrailV1:card:create", "lightrailV1:program:show", "lightrailV1:code:reate"];
        const secret: string = (await authConfigPromise).secretkey;
        let jwt = auth.sign(secret);//newBadge.sign(secret);

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


        // Step 3
        // email the recipient the fullcode
        // email contains: company name and redemption url (Stretch: logo). These are from turnkey config.
        const eParams = {
            Destination: {
                ToAddresses: ["tim+123@giftbit.com"]
            },
            Message: {
                Body: {
                    Text: {
                        Data: "Hey! What is up?"
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
                card: cardObject
            }
        };
    });

//noinspection JSUnusedGlobalSymbols
export const handler = router.getLambdaHandler();
