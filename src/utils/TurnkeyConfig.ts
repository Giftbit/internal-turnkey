import {isValidEmailAddress} from "./emailUtils";
import {GiftbitRestError} from "giftbit-cassava-routes/dist/GiftbitRestError";

export interface TurnkeyPublicConfig {
    additionalInfo: string;
    claimLink: string;
    companyName: string;
    companyWebsiteUrl: string;
    copyright: string;
    currency: string;
    customerSupportEmail: string;
    emailSubject?: string;
    giftEmailReplyToAddress: string;
    linkToPrivacy: string;
    linkToTerms: string;
    logo: string;
    programId: string;
    stripePublicKey: string;
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
        throw new GiftbitRestError(424, "Config was not set.", "MissingConfig");
    }
    if (!config.claimLink || !config.claimLink.includes(FULLCODE_REPLACMENT_STRING)) {
        console.log(`turnkey config claimLink must contain {{fullcode}} for replacement.`);
        throw new GiftbitRestError(424, "Config claimLink must be set and contain {{fullcode}} for replacement.", "InvalidClaimLink");
    }
    if (!config.companyName) {
        console.log("turnkey config companyName cannot be null");
        throw new GiftbitRestError(424, "Config companyName was not set.", "MissingCompanyName");
    }
    if (!config.companyWebsiteUrl) {
        console.log("turnkey config companyWebsiteUrl cannot be null");
        throw new GiftbitRestError(424, "Config companyWebsiteUrl was not set.", "MissingCompanyWebsiteUrl");
    }
    if (!config.copyright) {
        console.log("turnkey config copyright cannot be null");
        throw new GiftbitRestError(424, "Config copyright was not set.", "MissingCopyright");
    }
    if (!config.currency) {
        console.log("turnkey config currency cannot be null");
        throw new GiftbitRestError(424, "Config currency was not set.", "MissingCurrency");
    }
    if (!config.customerSupportEmail) {
        console.log("turnkey config customerSupportEmail cannot be null");
        throw new GiftbitRestError(424, "Config customerSupportEmail was not set.", "MissingCustomerSupportEmail");
    }
    if (!config.giftEmailReplyToAddress || !isValidEmailAddress(config.giftEmailReplyToAddress)) {
        console.log("turnkey config giftEmailReplyToAddress cannot be null");
        throw new GiftbitRestError(424, "Config giftEmailReplyToAddress must be a valid email.", "InvalidGiftEmailReplyToAddress");
    }
    if (!config.linkToPrivacy) {
        console.log("turnkey config linkToPrivacy cannot be null");
        throw new GiftbitRestError(424, "Config linkToPrivacy was not set.", "MissingLinkToPrivacy");
    }
    if (!config.linkToTerms) {
        console.log("turnkey config linkToTerms cannot be null");
        throw new GiftbitRestError(424, "Config linkToTerms was not set.", "MissingLinkToTerms");
    }
    if (!config.logo) {
        console.log("turnkey config logo cannot be null");
        throw new GiftbitRestError(424, "Config logo was not set.", "MissingLogo");
    }
    if (!config.programId) {
        console.log("turnkey config programId cannot be null");
        throw new GiftbitRestError(424, "Config programId was not set.", "MissingProgramId");
    }
    if (!config.stripePublicKey) {
        console.log("turnkey config stripePublicKey cannot be null");
        throw new GiftbitRestError(424, "Config stripePublicKey was not set.", "MissingStripePublicKey");
    }
    if (!config.termsAndConditions) {
        console.log("turnkey config termsAndConditions cannot be null");
        throw new GiftbitRestError(424, "Config termsAndConditions was not set.", "MissingTermsAndConditions");
    }
}