import * as aws from "aws-sdk";
import * as comsLib from "giftbit-lambda-comslib";
import * as uuid from "uuid/v4";
import {AuthorizationBadge} from "giftbit-cassava-routes/dist/jwtauth";

const region = process.env["AWS_REGION"] || "";     // automatically set by Lambda
const kinesisStreamArn = process.env["KINESIS_STREAM_ARN"] || "";

const kinesis = new aws.Kinesis({
    apiVersion: "2013-12-02",
    credentials: new aws.EnvironmentCredentials("AWS"),
    region: region
});

export async function sendEvent<T>(type: string, id: string, payload: any): Promise<void> {
    const msg: comsLib.Message = {
        id: id,
        type: type,
        payload: payload,
        timestamp: new Date()
    };
    console.log(`Sending event: ${JSON.stringify(msg)}`);

    const cborMsg = comsLib.encodeCbor(msg);

    const kinesisRecord: aws.Kinesis.PutRecordInput = {
        StreamName: kinesisStreamArnToName(kinesisStreamArn),
        Data: cborMsg,
        PartitionKey: uuid()
    };
    await kinesis.putRecord(kinesisRecord).promise();
}


function kinesisStreamArnToName(arn: string): string {
    const nameMatcher = /arn:aws:kinesis:[a-zA-Z0-9_.-]+:\d+:stream\/([a-zA-Z0-9_.-]+)/.exec(arn);
    if (!nameMatcher) {
        throw new Error(`Kinesis stream arn misconfigured: ${arn}`);
    }
    return nameMatcher[1];
}