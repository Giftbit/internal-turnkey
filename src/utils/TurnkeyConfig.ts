import {RestError} from "cassava";
export interface TurnkeyPublicConfig {
    claimLink: string;
    companyName: string;
    copyright: string;
    currency: string;
    linkToPrivacy: string;
    linkToTerms: string;
    logo: string;
    programId: string;
    stripePublicKey?: string;
    termsAndConditions: string;
}

export const REDEMPTION_LINK_FULLCODE_REPLACEMENT_STRING = "{{fullcode}}";

export function validateTurnkeyConfig(config: TurnkeyPublicConfig): void {
    if (!config) {
        console.log("turnkey config cannot be null");
        throw new RestError(424, "turnkey config was not set");
    }
    if (!config.claimLink || !config.claimLink.includes(REDEMPTION_LINK_FULLCODE_REPLACEMENT_STRING)) {
        console.log("turnkey config claimLink must contain {{fullcode}} for replacement.");
        throw new RestError(424, "turnkey config claimLink must contain {{fullcode}} for replacement");
    }
    if (!config.companyName) {
        console.log("turnkey config companyName cannot be null");
        throw new RestError(424, "turnkey config companyName was not set");
    }
    if (!config.copyright) {
        console.log("turnkey config copyright cannot be null");
        throw new RestError(424, "turnkey config copyright was not set");
    }
    if (!config.currency) {
        console.log("turnkey config currency cannot be null");
        throw new RestError(424, "turnkey config currency was not set");
    }
    if (!config.linkToPrivacy) {
        console.log("turnkey config linkToPrivacy cannot be null");
        throw new RestError(424, "turnkey config linkToPrivacy was not set");
    }
    if (!config.linkToTerms) {
        console.log("turnkey config linkToTerms cannot be null");
        throw new RestError(424, "turnkey config linkToTerms was not set");
    }
    if (!config.logo) {
        console.log("turnkey config logo cannot be null");
        throw new RestError(424, "turnkey config logo was not set");
    }
    if (!config.programId) {
        console.log("turnkey config programId cannot be null");
        throw new RestError(424, "turnkey config programId was not set");
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