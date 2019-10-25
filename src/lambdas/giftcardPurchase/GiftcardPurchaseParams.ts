import * as giftbitRoutes from "giftbit-cassava-routes";
import {httpStatusCode, RouterEvent} from "cassava";
import {isValidEmailAddress} from "../../utils/emailUtils";
import {GiftbitRestError} from "giftbit-cassava-routes/dist/GiftbitRestError";

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

export namespace GiftcardPurchaseParams {
    export function getFromRequest(request: RouterEvent): GiftcardPurchaseParams {
        const auth: giftbitRoutes.jwtauth.AuthorizationBadge = request.meta["auth"];
        const params = {
            initialValue: request.body.initialValue,
            message: request.body.message,
            recipientEmail: request.body.recipientEmail,
            senderEmail: request.body.senderEmail,
            senderName: request.body.senderName,
            stripeCardToken: request.body.stripeCardToken ? request.body.stripeCardToken : null,
            stripeCardId: request.body.stripeCardId ? request.body.stripeCardId : null,
            stripeCustomerId: auth.metadata ? auth.metadata.stripeCustomerId : null
        };
        validate(params);
        return params;
    }

    function validate(params: GiftcardPurchaseParams): void {
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

    export function getStripeMetadata(params: GiftcardPurchaseParams): {[key: string]: string | number} {
        return {
            sender_name: params.senderName,
            sender_email: params.senderEmail,
            recipient_email: params.recipientEmail,
            message: params.message && (params.message + "").substring(0, 499)
        };
    }

    export function getValueMetadata(params: GiftcardPurchaseParams): object {
        return {
            sender_name: params.senderName,
            sender_email: params.senderEmail,
            recipient_email: params.recipientEmail,
            message: params.message
        };
    }
}
