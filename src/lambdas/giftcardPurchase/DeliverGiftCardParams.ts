import {httpStatusCode, RouterEvent} from "cassava";
import {GiftbitRestError} from "giftbit-cassava-routes/dist/GiftbitRestError";
import {isValidEmailAddress} from "../../utils/emailUtils";

export interface DeliverGiftCardParams {
    cardId: string
    recipientEmail: string
    message?: string
    senderName?: string
}

export function setParamsFromRequest(request: RouterEvent): DeliverGiftCardParams {
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
    }
}