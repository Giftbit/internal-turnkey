import {httpStatusCode, RestError} from "cassava";

const EMAIL_REGEX = /(?:[a-z0-9!#\u0024%&'*+\/=?^_`{|}~-]+(?:\.[a-z0-9!#\u0024%&'*+\/=?^_`{|}~-]+)*|"(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21\x23-\x5b\x5d-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])*")@(?:(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?|\[(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?|[a-z0-9-]*[a-z0-9]:(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21-\x5a\x53-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])+)\])/

export interface GiftcardPurchaseParams {
    initialValue: number;
    message: string;
    recipientEmail: string;
    senderEmail: string;
    senderName: string;
    stripeCardToken: string;
}

export function setParamsFromRequest(request: any): GiftcardPurchaseParams {
    return {
        initialValue: request.body.initialValue,
        message: request.body.message,
        recipientEmail: request.body.recipientEmail,
        senderEmail: request.body.senderEmail,
        senderName: request.body.senderName,
        stripeCardToken: request.body.stripeCardToken
    };
}

export function validateParams(params: GiftcardPurchaseParams): void {
    if (!params.initialValue || params.initialValue <= 0) {
        console.log(`parameter initialValue failed validation. received ${params.initialValue}`);
        throw new RestError(httpStatusCode.clientError.BAD_REQUEST, "parameter initialValue must be a positive integer")
    }
    if (!params.message) {
        console.log(`parameter message failed validation. received ${params.message}`);
        throw new RestError(httpStatusCode.clientError.BAD_REQUEST, "parameter message must be set")
    }
    let recipientEmailIsValid = params.recipientEmail ? params.recipientEmail.match(EMAIL_REGEX) : false;
    if (!params.recipientEmail || !recipientEmailIsValid) {
        console.log(`parameter recipientEmail failed validation. received ${params.recipientEmail}`);
        throw new RestError(httpStatusCode.clientError.BAD_REQUEST, "parameter recipientEmail must be a valid email")
    }

    let senderEmailIsValid = params.senderEmail ? params.senderEmail.match(EMAIL_REGEX) : false;
    if (!params.senderEmail || !senderEmailIsValid) {
        console.log(`parameter senderEmail failed validation. received ${params.senderEmail}`);
        throw new RestError(httpStatusCode.clientError.BAD_REQUEST, "parameter senderEmail must be a valid email")
    }
    if (!params.senderName) {
        console.log(`parameter senderName failed validation. received ${params.senderName}`);
        throw new RestError(httpStatusCode.clientError.BAD_REQUEST, "parameter senderName must be set")
    }
    if (!params.stripeCardToken) {
        console.log(`parameter stripeCardToken failed validation. received ${params.stripeCardToken}`);
        throw new RestError(httpStatusCode.clientError.BAD_REQUEST, "parameter stripeCardToken must be set")
    }
}
