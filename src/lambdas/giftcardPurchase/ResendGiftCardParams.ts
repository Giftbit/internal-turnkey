import {httpStatusCode, RouterEvent} from "cassava";
import {GiftbitRestError} from "giftbit-cassava-routes/dist/GiftbitRestError";
import {isValidEmailAddress} from "../../utils/emailUtils";

export interface ResendGiftCardParams {
    cardId: string
    email: string
    message?: string
}

export function setParamsFromRequest(request: RouterEvent): ResendGiftCardParams {
    if (!request.body.cardId) {
        console.log(`parameter type failed validation. received ${request.body.cardId}`);
        throw new GiftbitRestError(httpStatusCode.clientError.BAD_REQUEST, `parameter cardId must be set`, "InvalidParamCardId");
    }

    const email = request.body.email;
    if (!email || !isValidEmailAddress(email)) {
        console.log(`parameter recipientEmail failed validation. received ${email}`);
        throw new GiftbitRestError(httpStatusCode.clientError.BAD_REQUEST, "parameter recipientEmail must be a valid email address", "InvalidParamRecipientEmail");
    }

    return {
        cardId: request.body.cardType,
        email: email,
        message: request.body.message,
    }
}