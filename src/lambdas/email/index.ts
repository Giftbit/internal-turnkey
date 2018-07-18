import * as cassava from "cassava";
import {httpStatusCode} from "cassava";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as metrics from "giftbit-lambda-metricslib";
import {getLightrailSourceEmailAddress, sendEmail} from "../../utils/emailUtils";
import {getParamsFromRequest} from "./EmailParameters";
import {EmailTemplate} from "./EmailTemplate";
import {GiftbitRestError} from "giftbit-cassava-routes/dist/GiftbitRestError";
import * as fs from "fs";

const DROPIN_TEMPLATE = require("./templates/dropInDeveloperOnboardEmail.html");

export const router = new cassava.Router();

router.route(new cassava.routes.LoggingRoute());

router.route(new giftbitRoutes.jwtauth.JwtAuthorizationRoute(
    giftbitRoutes.secureConfig.fetchFromS3ByEnvVar<giftbitRoutes.secureConfig.AuthenticationConfig>("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_JWT"),
    giftbitRoutes.secureConfig.fetchFromS3ByEnvVar<any>("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_ROLE_DEFINITIONS"),
    `https://${process.env["LIGHTRAIL_DOMAIN"]}${process.env["PATH_TO_MERCHANT_SHARED_SECRET"]}`,
    giftbitRoutes.secureConfig.fetchFromS3ByEnvVar<giftbitRoutes.secureConfig.AssumeScopeToken>("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_ASSUME_STORAGE_SCOPE_TOKEN"))
);

const EMAIL_TEMPLATES: { [key: string]: EmailTemplate } = {
    DROP_IN_DEVELOPER_ONBOARDING: {
        content: DROPIN_TEMPLATE,
        subject: "Getting started with Lightrail's Drop-in Gift Cards",
        requiredScopes: []
    }
};

router.route("/v1/turnkey/email")
    .method("POST")
    .handler(async evt => {
        const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
        metrics.histogram("turnkey.email", 1, [`mode:${auth.isTestUser() ? "test" : "live"}`]);
        metrics.flush();
        auth.requireIds("giftbitUserId");

        const params = getParamsFromRequest(evt, EMAIL_TEMPLATES);
        console.log(`Send email requested. Params ${JSON.stringify(params)}.`);

        if (params.emailTemplate.requiredScopes.length > 0) {
            auth.requireScopes(...params.emailTemplate.requiredScopes);
        }
        let emailContent = fs.readFileSync(params.emailTemplate.content).toString("utf-8");
        emailContent = replaceEmailPlaceholders(emailContent, params.replacements);

        try {
            await sendEmail({
                toAddress: params.recipientEmail,
                subject: params.emailTemplate.subject,
                body: emailContent,
                replyToAddress: getLightrailSourceEmailAddress()
            });
        } catch (err) {
            console.log(`An error occurred while attempting to send email. Params: Error: ${err}.`);
            throw new GiftbitRestError(httpStatusCode.serverError.INTERNAL_SERVER_ERROR);
        }

        return {
            body: {
                sent: true
            }
        };
    });

//noinspection JSUnusedGlobalSymbols
export const handler = metrics.wrapLambdaHandler({
    secureConfig: giftbitRoutes.secureConfig.fetchFromS3ByEnvVar("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_DATADOG"),
    handler: giftbitRoutes.sentry.wrapLambdaHandler({
        router,
        secureConfig: giftbitRoutes.secureConfig.fetchFromS3ByEnvVar("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_SENTRY")
    })
});

function replaceEmailPlaceholders(emailContent: string, replacements: {[key: string]: string}): string {
    for (const key of Object.keys(replacements)) {
        const pattern = new RegExp(`__${key}__`, "g");
        if (emailContent.search(pattern) === -1) {
            console.log(`User provided a replacement key ${key} that was not found in the email content.`);
            throw new GiftbitRestError(httpStatusCode.clientError.BAD_REQUEST, `parameter replacement.${key} is not a replacement key that needs to be replaced in this email.`, "InvalidParamUnknownReplacementKey");
        }
        emailContent = emailContent.replace(pattern, replacements[key]);
    }
    const regex = /__(.*?)__/g;
    const match = regex.exec(emailContent);
    if (match) {
        console.log(`Found un-replaced string ${match[0]} in email content. Returning 400.`);
        throw new GiftbitRestError(httpStatusCode.clientError.BAD_REQUEST, `email has un-replaced value ${match[1]}`, "MissedParameterReplacement");
    }
    return emailContent;
}
