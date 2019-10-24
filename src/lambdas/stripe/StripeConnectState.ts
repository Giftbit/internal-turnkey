import * as aws from "aws-sdk";
import * as dynameh from "dynameh";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as uuid from "uuid";

/**
 * State stored after initiating Stripe Connect, and retrieved after the callback
 * to complete it.
 */
export interface StripeConnectState {
    uuid: string;
    ttl: string | Date;
    jwtPayload: giftbitRoutes.jwtauth.JwtPayload;
}

export const dynamodb = new aws.DynamoDB({
    apiVersion: "2012-08-10",
    credentials: process.env["AWS_REGION"] ? new aws.EnvironmentCredentials("AWS") : new aws.SharedIniFileCredentials({profile: "default"}),
    region: process.env["AWS_REGION"] || "us-west-2"
});

export const tableSchema: dynameh.TableSchema = {
    tableName: process.env["STRIPE_CONNECT_STATE_TABLE"] || "Table",
    partitionKeyField: "uuid",
    partitionKeyType: "string",
    ttlField: "ttl"
};

export namespace StripeConnectState {
    export async function create(auth: giftbitRoutes.jwtauth.AuthorizationBadge): Promise<StripeConnectState> {
        const ttl = new Date();
        ttl.setTime(ttl.getTime() + 6 * 60 * 60 * 1000);
        const state: StripeConnectState = {
            uuid: uuid.v4(),
            ttl,
            jwtPayload: auth.getJwtPayload()
        };

        const putReq = dynameh.requestBuilder.buildPutInput(tableSchema, state);
        await dynamodb.putItem(putReq).promise();

        return state;
    }

    export async function get(uuid: string): Promise<StripeConnectState> {
        const getReq = dynameh.requestBuilder.buildGetInput(tableSchema, uuid);
        const getResp = await dynamodb.getItem(getReq).promise();
        return dynameh.responseUnwrapper.unwrapGetOutput(getResp);
    }
}
