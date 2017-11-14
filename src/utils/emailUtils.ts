import * as aws from "aws-sdk";
import {SendEmailResponse} from "aws-sdk/clients/ses";
import {SendEmailParams} from "./SendEmailParams";
import SES = require("aws-sdk/clients/ses");

const ses = new aws.SES({region: 'us-west-2'});

const VALID_EMAIL_ADDRESS_REGEX = /(?:[a-z0-9!#\u0024%&'*+\/=?^_`{|}~-]+(?:\.[a-z0-9!#\u0024%&'*+\/=?^_`{|}~-]+)*|"(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21\x23-\x5b\x5d-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])*")@(?:(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?|\[(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?|[a-z0-9-]*[a-z0-9]:(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21-\x5a\x53-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])+)\])/;

export function isValidEmailAddress(email: string): boolean {
    return VALID_EMAIL_ADDRESS_REGEX.test(email);
}

export async function sendEmail(params: SendEmailParams): Promise<SendEmailResponse> {
    const eParams: SES.Types.SendEmailRequest = {
        Destination: {
            ToAddresses: [params.toAddress]
        },
        Message: {
            Body: {
                Html: {
                    Data: params.body
                }
            },
            Subject: {
                Data: params.subject
            }
        },
        ReplyToAddresses: [params.replyToAddress],
        Source: process.env["OUTGOING_EMAIL_FROM_ADDRESS"]
    };
    console.log(`Sending email: ${JSON.stringify(eParams)}`);
    return ses.sendEmail(eParams).promise();
}