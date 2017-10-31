import {httpStatusCode, RestError} from "cassava";

const EMAIL_REGEX = /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/

export interface GiftcardPurchaseParams {
    currency: string;
    initialValue: number;
    senderName: string;
    senderEmail: string;
    recipientEmail: string;
    message: string;
    stripeCardToken: string;
}

export function setParamsFromRequest(request: any): GiftcardPurchaseParams {
    return {
        currency: request.body.currency,
        initialValue: request.body.initialValue,
        senderName: request.body.senderName,
        senderEmail: request.body.senderEmail,
        recipientEmail: request.body.recipientEmail,
        message: request.body.message,
        stripeCardToken: request.body.stripeCardToken
    };
}

export function validateParams(params: GiftcardPurchaseParams): void {
    if (!params.currency) {
        console.log(`parameter currency failed validation. received ${params.currency}`);
        throw new RestError(httpStatusCode.clientError.BAD_REQUEST, "parameter currency must be set")
    }
    if (!params.initialValue || params.initialValue <= 0) {
        console.log(`parameter initialValue failed validation. received ${params.initialValue}`);
        throw new RestError(httpStatusCode.clientError.BAD_REQUEST, "parameter initialValue must be a positive integer")
    }
    if (!params.senderName) {
        console.log(`parameter senderName failed validation. received ${params.senderName}`);
        throw new RestError(httpStatusCode.clientError.BAD_REQUEST, "parameter senderName must be set")
    }
    if (!params.senderEmail) {
        console.log(`parameter senderEmail failed validation. received ${params.senderEmail}`);
        throw new RestError(httpStatusCode.clientError.BAD_REQUEST, "parameter senderEmail must be set")
    }
    console.log("about to do regex validation");
    let regexResult = params.recipientEmail.match(EMAIL_REGEX);
    console.log("email passed regex: " + (regexResult != null).toString());
    if (!params.recipientEmail) {
        console.log(`parameter recipientEmail failed validation. received ${params.recipientEmail}`);
        throw new RestError(httpStatusCode.clientError.BAD_REQUEST, "parameter recipientEmail must be set")
    }
    if (!params.message) {
        console.log(`parameter message failed validation. received ${params.message}`);
        throw new RestError(httpStatusCode.clientError.BAD_REQUEST, "parameter message must be set")
    }
    if (!params.stripeCardToken) {
        console.log(`parameter stripeCardToken failed validation. received ${params.stripeCardToken}`);
        throw new RestError(httpStatusCode.clientError.BAD_REQUEST, "parameter stripeCardToken must be set")
    }
}
