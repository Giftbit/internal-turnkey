import {formatCurrency} from "../../utils/currencyUtils";
import {FULLCODE_REPLACMENT_STRING, TurnkeyPublicConfig} from "../../utils/TurnkeyConfig";
import {sendEmail} from "../../utils/emailUtils";
import {RECIPIENT_EMAIL} from "./RecipientEmail";
import {SendEmailResponse} from "aws-sdk/clients/ses";

export interface EmailGiftToRecipientParams {
    fullcode: string;
    message: string;
    recipientEmail: string;
    senderName: string;
    initialValue: number;
}

export async function emailGiftToRecipient(params: EmailGiftToRecipientParams, turnkeyConfig: TurnkeyPublicConfig): Promise<SendEmailResponse> {
    const claimLink = turnkeyConfig.claimLink.replace(FULLCODE_REPLACMENT_STRING, params.fullcode);
    const from = params.senderName ? `From ${params.senderName}` : "";
    const emailSubject = turnkeyConfig.emailSubject ? turnkeyConfig.emailSubject : `You have received a gift card for ${turnkeyConfig.companyName}`;
    params.message = params.message ? params.message : "Hi there, please enjoy this gift.";

    let emailTemplate = RECIPIENT_EMAIL;
    const templateReplacements = [
        {key: "fullcode", value: params.fullcode},
        {key: "claimLink", value: claimLink},
        {key: "senderFrom", value: from},
        {key: "emailSubject", value: emailSubject},
        {key: "message", value: params.message},
        {key: "initialValue", value: formatCurrency(params.initialValue, turnkeyConfig.currency)},
        {key: "additionalInfo", value: turnkeyConfig.additionalInfo || " "},
        {key: "claimLink", value: turnkeyConfig.claimLink},
        {key: "companyName", value: turnkeyConfig.companyName},
        {key: "companyWebsiteUrl", value: turnkeyConfig.companyWebsiteUrl},
        {key: "copyright", value: turnkeyConfig.copyright},
        {key: "copyrightYear", value: new Date().getUTCFullYear().toString()},
        {key: "customerSupportEmail", value: turnkeyConfig.customerSupportEmail},
        {key: "linkToPrivacy", value: turnkeyConfig.linkToPrivacy},
        {key: "linkToTerms", value: turnkeyConfig.linkToTerms},
        {key: "logo", value: turnkeyConfig.logo},
        {key: "termsAndConditions", value: turnkeyConfig.termsAndConditions},
    ];

    for (const replacement of templateReplacements) {
        const regexp = new RegExp(`__${replacement.key}__`, "g");
        emailTemplate = emailTemplate.replace(regexp, replacement.value);
    }

    const sendEmailResponse = await sendEmail({
        toAddress: params.recipientEmail,
        subject: emailSubject,
        body: emailTemplate,
        replyToAddress: turnkeyConfig.giftEmailReplyToAddress,
    });
    console.log(`Email sent. MessageId: ${sendEmailResponse.MessageId}.`);
    return sendEmailResponse;
}
