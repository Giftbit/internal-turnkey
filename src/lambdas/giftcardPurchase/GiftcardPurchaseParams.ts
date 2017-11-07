import {httpStatusCode, RestError} from "cassava";

const EMAIL_REGEX = /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/

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
    let emailMatch = params.recipientEmail.match(EMAIL_REGEX);
    console.log(`emailMatch: ${emailMatch}`);
    console.log(`!emailMatch = ${!emailMatch}`);
    if (!params.recipientEmail || !emailMatch) {
        console.log(`parameter recipientEmail failed validation. received ${params.recipientEmail}`);
        throw new RestError(httpStatusCode.clientError.BAD_REQUEST, "parameter recipientEmail must be a valid email")
    }
    if (!params.senderEmail) {
        console.log(`parameter senderEmail failed validation. received ${params.senderEmail}`);
        throw new RestError(httpStatusCode.clientError.BAD_REQUEST, "parameter senderEmail must be set")
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
