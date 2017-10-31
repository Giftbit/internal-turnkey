import {httpStatusCode, RestError} from "cassava";
export interface TurnkeyPublicConfig {
    companyName: string;
    logo: string;
    programId: string;
    termsAndConditions: string;
}

export function validatePublicTurnkeyConfig(config: TurnkeyPublicConfig): void {
    if (!config.companyName) {
        console.log("turnkey config companyName cannot be null");
        throw new RestError(httpStatusCode.serverError.INTERNAL_SERVER_ERROR, "turnkey config companyName was not set.");
    }
    if (!config.logo) {
        console.log("turnkey config logo cannot be null");
        throw new RestError(httpStatusCode.serverError.INTERNAL_SERVER_ERROR, "turnkey config logo was not set.");
    }
    if (!config.programId) {
        console.log("turnkey config programId cannot be null");
        throw new RestError(httpStatusCode.serverError.INTERNAL_SERVER_ERROR, "turnkey config programId was not set.");
    }
    if (!config.termsAndConditions) {
        console.log("turnkey config termsAndConditions cannot be null");
        throw new RestError(httpStatusCode.serverError.INTERNAL_SERVER_ERROR, "turnkey config termsAndConditions was not set.");
    }
}