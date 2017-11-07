import {RestError} from "cassava";
export interface TurnkeyConfig {
    companyName: string;
    currency: string;
    logo: string;
    programId: string;
    stripePublicKey: string;
    redemptionLink: string;
    termsAndConditions: string;
}

export const REDEMPTION_LINK_FULLCODE_REPLACEMENT_STRING = "{{fullcode}}";

export function validateTurnkeyConfig(config: TurnkeyConfig): void {
    if (!config) {
        console.log("turnkey config cannot be null");
        throw new RestError(424, "turnkey config was not set");
    }
    if (!config.companyName) {
        console.log("turnkey config companyName cannot be null");
        throw new RestError(424, "turnkey config companyName was not set");
    }
    if (!config.currency) {
        console.log("turnkey config currency cannot be null");
        throw new RestError(424, "turnkey config currency was not set");
    }
    if (!config.logo) {
        console.log("turnkey config logo cannot be null");
        throw new RestError(424, "turnkey config logo was not set");
    }
    if (!config.programId) {
        console.log("turnkey config programId cannot be null");
        throw new RestError(424, "turnkey config programId was not set");
    }
    if (!config.redemptionLink || !config.redemptionLink.includes(REDEMPTION_LINK_FULLCODE_REPLACEMENT_STRING)) {
        console.log("turnkey config redemptionLink must contain {{fullcode}} for replacement.");
        throw new RestError(424, "turnkey config redemptionLink must contain {{fullcode}} for replacement");
    }
    if (!config.stripePublicKey) {
        console.log("turnkey config stripePublicKey cannot be null");
        throw new RestError(424, "turnkey config stripePublicKey was not set");
    }
    if (!config.termsAndConditions) {
        console.log("turnkey config termsAndConditions cannot be null");
        throw new RestError(424, "turnkey config termsAndConditions was not set");
    }
}