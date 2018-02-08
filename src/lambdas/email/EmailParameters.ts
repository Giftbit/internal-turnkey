import {httpStatusCode, RouterEvent} from "cassava";
import {EmailTemplate} from "./EmailTemplate";
import {isValidEmailAddress} from "../../utils/emailUtils";
import {GiftbitRestError} from "giftbit-cassava-routes/dist/GiftbitRestError";

export interface EmailParameters {
    emailTemplate: EmailTemplate;
    recipientEmail: string;
    replacements: Object;
}

export function setParamsFromRequest(request: RouterEvent, EMAIL_TEMPLATES: {[string: string]: EmailTemplate}): EmailParameters {
    if (!request.body.type || EMAIL_TEMPLATES[request.body.type] == null) {
        console.log(`parameter type failed validation. received ${request.body.type}`);
        throw new GiftbitRestError(httpStatusCode.clientError.BAD_REQUEST, `parameter type must belong to [${Object.keys(EMAIL_TEMPLATES).join(", ")}]`, "InvalidParamType");
    }
    const emailTemplate = EMAIL_TEMPLATES[request.body.type];

    const recipientEmail = request.body.recipientEmail;
    if (!recipientEmail || !isValidEmailAddress(recipientEmail)) {
        console.log(`parameter recipientEmail failed validation. received ${recipientEmail}`);
        throw new GiftbitRestError(httpStatusCode.clientError.BAD_REQUEST, "parameter recipientEmail must be a valid email address", "InvalidParamRecipientEmail");
    }

    let replacements = request.body.replacements;

    if (replacements && !(replacements instanceof Object)) {
        console.log(`parameter replacement failed validation. received ${replacements}`);
        throw new GiftbitRestError(httpStatusCode.clientError.BAD_REQUEST, "parameter replacements must be a valid key value key-value map", "InvalidParamReplacements");
    }

    return {
        emailTemplate: emailTemplate,
        recipientEmail: request.body.recipientEmail,
        replacements: replacements,
    }
}

