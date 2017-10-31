import {httpStatusCode, RestError} from "cassava";
export interface TurnkeyPrivateConfig {
    stripeSecret: string;
}

export function validatePrivateTurnkeyConfig(config: TurnkeyPrivateConfig): void {
    if (!config.stripeSecret) {
        console.log("turnkey config stripeSecret cannot be null");
        throw new RestError(httpStatusCode.serverError.INTERNAL_SERVER_ERROR, "turnkey config stripeSecret was not set.");
    }
}