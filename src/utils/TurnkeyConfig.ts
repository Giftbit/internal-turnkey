import {RestError} from "cassava";
import {isValidEmailAddress} from "./emailUtils";

export interface TurnkeyPublicConfig {
    claimLink: string;
    companyName: string;
    copyright: string;
    currency: string;
    giftEmailReplyToAddress: string;
    linkToPrivacy: string;
    linkToTerms: string;
    logo: string;
    programId: string;
    stripePublicKey?: string;
    termsAndConditions: string;
}

export const FULLCODE_REPLACMENT_STRING = "{{fullcode}}";

/**
 * Validates all config parameters are correctly set.
 * The reason for this is we want the gift card purchase service to stop upfront in the event there is a problem with config.
 * This is due to the multiple transactions involved (ie Stripe and Lightrail). It's better to avoid a refund / card cancellation if possible.
 * @param config
 */
export function validateTurnkeyConfig(config: TurnkeyPublicConfig): void {
    if (!config) {
        console.log("turnkey config cannot be null");
        throw new RestError(424, "config was not set");
    }
    if (!config.claimLink || !config.claimLink.includes(FULLCODE_REPLACMENT_STRING)) {
        console.log("turnkey config claimLink must contain {{fullcode}} for replacement.");
        throw new RestError(424, "config claimLink must be set and contain {{fullcode}} for replacement");
    }
    if (!config.companyName) {
        console.log("turnkey config companyName cannot be null");
        throw new RestError(424, "config companyName was not set");
    }
    if (!config.copyright) {
        console.log("turnkey config copyright cannot be null");
        throw new RestError(424, "config copyright was not set");
    }
    if (!config.currency) {
        console.log("turnkey config currency cannot be null");
        throw new RestError(424, "config currency was not set");
    }
    if (!config.giftEmailReplyToAddress || !isValidEmailAddress(config.giftEmailReplyToAddress)) {
        console.log("turnkey config giftEmailReplyToAddress cannot be null");
        throw new RestError(424, "config giftEmailReplyToAddress must be a valid email");
    }
    if (!config.linkToPrivacy) {
        console.log("turnkey config linkToPrivacy cannot be null");
        throw new RestError(424, "config linkToPrivacy was not set");
    }
    if (!config.linkToTerms) {
        console.log("turnkey config linkToTerms cannot be null");
        throw new RestError(424, "config linkToTerms was not set");
    }
    if (!config.logo) {
        console.log("turnkey config logo cannot be null");
        throw new RestError(424, "config logo was not set");
    }
    if (!config.programId) {
        console.log("turnkey config programId cannot be null");
        throw new RestError(424, "config programId was not set");
    }
    if (!config.stripePublicKey) {
        console.log("turnkey config stripePublicKey cannot be null");
        throw new RestError(424, "config stripePublicKey was not set");
    }
    if (!config.termsAndConditions) {
        console.log("turnkey config termsAndConditions cannot be null");
        throw new RestError(424, "config termsAndConditions was not set");
    }
}