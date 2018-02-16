import {httpStatusCode, RouterEvent} from "cassava";
import {GiftbitRestError} from "giftbit-cassava-routes/dist/GiftbitRestError";
import {isValidEmailAddress} from "../../utils/emailUtils";

export interface DeliverGiftCardParams {
    cardId: string
    email: string
    message?: string
    senderName?: string
}

export function setParamsFromRequest(request: RouterEvent): DeliverGiftCardParams {
    const cardId = request.body.cardId;
    if (!cardId) {
        console.log(`parameter type failed validation. received ${request.body.cardId}`);
        throw new GiftbitRestError(httpStatusCode.clientError.BAD_REQUEST, `parameter cardId must be set`, "InvalidParamCardId");
    }

    const email = request.body.email;
    if (!email || !isValidEmailAddress(email)) {
        console.log(`parameter recipientEmail failed validation. received ${email}`);
        throw new GiftbitRestError(httpStatusCode.clientError.BAD_REQUEST, "parameter recipientEmail must be a valid email address", "InvalidParamRecipientEmail");
    }

    // const message = request.body.message;
    // if (!message) {
    //     console.log(`parameter message failed validation. received ${message}`);
    //     throw new GiftbitRestError(httpStatusCode.clientError.BAD_REQUEST, "parameter message must be set", "InvalidParamMessage");
    // }

    return {
        cardId: cardId,
        email: email,
        message: request.body.message,
        senderName: request.body.senderName,
    }
}