import {httpStatusCode, RouterEvent} from "cassava";
import {isValidEmailAddress} from "../../utils/emailUtils";
import {GiftbitRestError} from "giftbit-cassava-routes/dist/GiftbitRestError";
import * as giftbitRoutes from "giftbit-cassava-routes";

export interface GiftcardPurchaseParams {
    initialValue: number;
    message?: string;
    recipientEmail: string;
    senderEmail: string;
    senderName?: string;
    stripeCardToken?: string;
    stripeCardId?: string;
    stripeCustomerId?: string;
}

export function setParamsFromRequest(request: RouterEvent, auth: giftbitRoutes.jwtauth.AuthorizationBadge): GiftcardPurchaseParams {
    return {
        initialValue: request.body.initialValue,
        message: request.body.message,
        recipientEmail: request.body.recipientEmail,
        senderEmail: request.body.senderEmail,
        senderName: request.body.senderName,
        stripeCardToken: request.body.stripeCardToken ? request.body.stripeCardToken : null,
        stripeCardId: request.body.stripeCardId ? request.body.stripeCardId : null,
        stripeCustomerId: auth.metadata ? auth.metadata.stripeCustomerId : null
    };
}

export function validateParams(params: GiftcardPurchaseParams): void {
    if (!params.initialValue || params.initialValue <= 0) {
        console.log(`parameter initialValue failed validation. received ${params.initialValue}`);
        throw new GiftbitRestError(httpStatusCode.clientError.BAD_REQUEST, "parameter initialValue must be a positive integer", "InvalidParamInitialValue");
    }

    if (!params.recipientEmail || !isValidEmailAddress(params.recipientEmail)) {
        console.log(`parameter recipientEmail failed validation. received ${params.recipientEmail}`);
        throw new GiftbitRestError(httpStatusCode.clientError.BAD_REQUEST, "parameter recipientEmail must be a valid email", "InvalidParamRecipientEmail");
    }

    if (!params.senderEmail || !isValidEmailAddress(params.senderEmail)) {
        console.log(`parameter senderEmail failed validation. received ${params.senderEmail}`);
        throw new GiftbitRestError(httpStatusCode.clientError.BAD_REQUEST, "parameter senderEmail must be a valid email", "InvalidParamSenderEmail");
    }

    if (!params.stripeCardToken && !params.stripeCardId) {
        console.log(`parameters stripeCardToken and stripeCardId failed validation. received ${params.stripeCardToken}, ${params.stripeCardId} respectively`);
        throw new GiftbitRestError(httpStatusCode.clientError.BAD_REQUEST, "parameter stripeCardToken or stripeCardId must be set", "InvalidParamStripeCardTokens");
    }

    if (params.stripeCardToken && params.stripeCardId) {
        console.log(`parameters stripeCardToken and stripeCardId failed validation. received ${params.stripeCardToken}, ${params.stripeCardId} respectively`);
        throw new GiftbitRestError(httpStatusCode.clientError.BAD_REQUEST, "parameter stripeCardToken and stripeCardId cannot both be set", "InvalidParamStripeCardTokens");
    }

    if (params.stripeCardId && !params.stripeCustomerId) {
        console.log(`parameters stripeCardId failed validation. received ${params.stripeCardToken}, but did not receive a stripeCustomerId in the auth metadata.`);
        throw new GiftbitRestError(httpStatusCode.clientError.BAD_REQUEST, "parameter stripeCardId requires a stripeCustomerId is set in the auth metadata", "InvalidAuthMetadataMissingStripeCustomerId");
    }
}
