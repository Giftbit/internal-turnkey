/**
 * A basic interface that can be used to send email using emailUtils.
 */
export interface SendEmailParams {
    toAddress: string;
    subject: string;
    body: string;
    replyToAddress: string;
}