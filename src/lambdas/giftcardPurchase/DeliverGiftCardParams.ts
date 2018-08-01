import {httpStatusCode, RouterEvent} from "cassava";
import {GiftbitRestError} from "giftbit-cassava-routes/dist/GiftbitRestError";
import {isValidEmailAddress} from "../../utils/emailUtils";

export interface DeliverGiftCardV1Params {
    cardId: string;
    recipientEmail: string;
    message?: string;
    senderName?: string;
}

export namespace DeliverGiftCardV1Params {
    export function getFromRequest(request: RouterEvent): DeliverGiftCardV1Params {
        const cardId = request.body.cardId;
        if (!cardId) {
            console.log(`parameter type failed validation. received ${request.body.cardId}`);
            throw new GiftbitRestError(httpStatusCode.clientError.BAD_REQUEST, `parameter cardId must be set`, "InvalidParamCardId");
        }

        const recipientEmail = request.body.recipientEmail;
        if (!recipientEmail || !isValidEmailAddress(recipientEmail)) {
            console.log(`parameter recipientEmail failed validation. received ${recipientEmail}`);
            throw new GiftbitRestError(httpStatusCode.clientError.BAD_REQUEST, "parameter recipientEmail must be a valid email address", "InvalidParamRecipientEmail");
        }

        return {
            cardId: cardId,
            recipientEmail: recipientEmail,
            message: request.body.message,
            senderName: request.body.senderName,
        };
    }
}

export interface DeliverGiftCardV2Params {
    valueId: string;
    recipientEmail: string;
    message?: string;
    senderName?: string;
}

export namespace DeliverGiftCardV2Params {
    export function getFromRequest(request: RouterEvent): DeliverGiftCardV2Params {
        const valueId = request.body.valueId;
        if (!valueId) {
            console.log(`parameter type failed validation. received ${request.body.valueId}`);
            throw new GiftbitRestError(httpStatusCode.clientError.BAD_REQUEST, `parameter valueId must be set`, "InvalidParamValueId");
        }

        const recipientEmail = request.body.recipientEmail;
        if (!recipientEmail || !isValidEmailAddress(recipientEmail)) {
            console.log(`parameter recipientEmail failed validation. received ${recipientEmail}`);
            throw new GiftbitRestError(httpStatusCode.clientError.BAD_REQUEST, "parameter recipientEmail must be a valid email address", "InvalidParamRecipientEmail");
        }

        return {
            valueId: valueId,
            recipientEmail: recipientEmail,
            message: request.body.message,
            senderName: request.body.senderName,
        };
    }
}
