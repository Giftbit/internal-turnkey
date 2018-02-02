import "babel-polyfill";
import * as cassava from "cassava";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as metrics from "giftbit-lambda-metricslib";
import {errorNotificationWrapper, sendErrorNotificaiton} from "giftbit-cassava-routes/dist/sentry";
import {sendEmail} from "../../utils/emailUtils";
import {setParamsFromRequest} from "./EmailParameters";
import {httpStatusCode, RestError} from "cassava";
const dropinTemplate = require("./templates/dropInDeveloperOnboardEmail.html"); // import * from "./templates/dropInDeveloperOnboardEmail.html"
const testTemplate = require("./templates/testEmail.html"); // import * from "./templates/dropInDeveloperOnboardEmail.html"
const fs = require("fs");

export const router = new cassava.Router();

router.route(new cassava.routes.LoggingRoute());

const authConfigPromise = giftbitRoutes.secureConfig.fetchFromS3ByEnvVar<giftbitRoutes.secureConfig.AuthenticationConfig>("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_JWT");
const roleDefinitionsPromise = giftbitRoutes.secureConfig.fetchFromS3ByEnvVar<any>("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_ROLE_DEFINITIONS");
const assumeGetSharedSecretToken = giftbitRoutes.secureConfig.fetchFromS3ByEnvVar<giftbitRoutes.secureConfig.AssumeScopeToken>("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_ASSUME_STORAGE_SCOPE_TOKEN");
router.route(new giftbitRoutes.jwtauth.JwtAuthorizationRoute(authConfigPromise, roleDefinitionsPromise, `https://${process.env["LIGHTRAIL_DOMAIN"]}${process.env["PATH_TO_MERCHANT_SHARED_SECRET"]}`, assumeGetSharedSecretToken));

const emailTypes = {
  dropIn: dropinTemplate,
  test: testTemplate
};
/**
 * Deprecated. Requests should be using /turnkey/giftcard/purchase
 */
router.route("/v1/turnkey/email")
    .method("POST")
    .handler(async evt => {
        const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
        metrics.histogram("turnkey.giftcardpurchase", 1, [`mode:${auth.isTestUser() ? "test" : "live"}`]);
        metrics.flush();
        auth.requireIds("giftbitUserId");
        // auth.requireScopes("lightrailV1:purchaseGiftcard");

        console.log("DROP-IN TEMPLATE " + dropinTemplate);
        console.log(fs.readFileSync(dropinTemplate).toString("utf-8"));
        const params = setParamsFromRequest(evt);
        const emailTemplate = emailTypes[params.type];
        if (!emailTemplate) {
            throw new RestError(httpStatusCode.clientError.BAD_REQUEST, `Invalid type, must belong to ${emailTypes}`);
        }




        const sendEmailResponse = await sendEmail({
            toAddress: params.recipientEmail,
            subject: "This is a subject and needs to be updated badly",
            body: emailTemplate,
            replyToAddress: "notifications@lightrail.com" //todo - fix,
        });

        return {
            body: {
                sent: true
            }
        };
    });
//
// async function emailGiftToRecipient(params: EmailGiftCardParams, turnkeyConfig: TurnkeyPublicConfig): Promise<SendEmailResponse> {
//     const fullcode: string = (await lightrail.cards.getFullcode(params.cardId)).code;
//     console.log(`retrieved fullcode lastFour ${fullcode.substring(fullcode.length - 4)}`);
//     const claimLink = turnkeyConfig.claimLink.replace(FULLCODE_REPLACMENT_STRING, fullcode);
//     const from = params.senderName ? `From ${params.senderName}` : "";
//     const emailSubject = turnkeyConfig.emailSubject ? turnkeyConfig.emailSubject : `You have received a gift card for ${turnkeyConfig.companyName}`;
//     params.message = params.message ? params.message : "Hi there, please enjoy this gift.";
//
//     let emailTemplate = RECIPIENT_EMAIL;
//     const templateReplacements = [
//         {key: "fullcode", value: fullcode},
//         {key: "claimLink", value: claimLink},
//         {key: "senderFrom", value: from},
//         {key: "emailSubject", value: emailSubject},
//         {key: "message", value: params.message},
//         {key: "initialValue", value: formatCurrency(params.initialValue, turnkeyConfig.currency)},
//         {key: "additionalInfo", value: turnkeyConfig.additionalInfo || " "},
//         {key: "claimLink", value: turnkeyConfig.claimLink},
//         {key: "companyName", value: turnkeyConfig.companyName},
//         {key: "companyWebsiteUrl", value: turnkeyConfig.companyWebsiteUrl},
//         {key: "copyright", value: turnkeyConfig.copyright},
//         {key: "copyrightYear", value: new Date().getUTCFullYear().toString()},
//         {key: "customerSupportEmail", value: turnkeyConfig.customerSupportEmail},
//         {key: "linkToPrivacy", value: turnkeyConfig.linkToPrivacy},
//         {key: "linkToTerms", value: turnkeyConfig.linkToTerms},
//         {key: "logo", value: turnkeyConfig.logo},
//         {key: "termsAndConditions", value: turnkeyConfig.termsAndConditions},
//     ];
//
//     for (const replacement of templateReplacements) {
//         const regexp = new RegExp(`__${replacement.key}__`, "g");
//         emailTemplate = emailTemplate.replace(regexp, replacement.value);
//     }
//
//     const sendEmailResponse = await sendEmail({
//         toAddress: params.recipientEmail,
//         subject: emailSubject,
//         body: emailTemplate,
//         replyToAddress: turnkeyConfig.giftEmailReplyToAddress,
//     });
//     console.log(`Email sent. MessageId: ${sendEmailResponse.MessageId}.`);
//     return sendEmailResponse;
// }

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
