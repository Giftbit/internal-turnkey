import {RouterEvent} from "cassava";

export interface EmailParameters {
    replacements: { [key: string]: any; };
    recipientEmail: string;
    type: string;
}

export function setParamsFromRequest(request: RouterEvent): EmailParameters {
    return {
        replacements: request.body.replacements,
        recipientEmail: request.body.recipientEmail,
        type: request.body.type
    };
}