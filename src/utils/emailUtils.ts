import * as aws from "aws-sdk";
import {SendEmailResponse} from "aws-sdk/clients/ses";
import {SendEmailParams} from "./SendEmailParams";
import SES = require("aws-sdk/clients/ses");

const ses = new aws.SES({region: 'us-west-2'});

const VALID_EMAIL_ADDRESS_REGEX = /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;

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