import * as cassava from "cassava";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as metrics from "giftbit-lambda-metricslib";
import * as superagent from "superagent";
import {validateConfig} from "./validateConfig";
import {GiftcardPurchaseParams} from "./GiftcardPurchaseParams";
import {createStripeCharge, rollbackCharge, updateStripeCharge} from "../../utils/stripeAccess";
import {Charge} from "../../utils/stripedtos/Charge";
import {passesFraudCheck} from "./passesFraudCheck";
import {GiftbitRestError} from "giftbit-cassava-routes/dist/GiftbitRestError";
import {TurnkeyPublicConfig, validateTurnkeyConfig} from "../../utils/TurnkeyConfig";
import {emailGiftToRecipient} from "./emailGiftToRecipient";
import {DeliverGiftCardV2Params} from "./DeliverGiftCardParams";
import * as turnkeyConfigUtil from "../../utils/turnkeyConfigStore";
import {assumeGiftcardDeliverToken, assumeGiftcardPurchaseToken} from "./lightrailV1";

export async function purchaseGiftcard(evt: cassava.RouterEvent): Promise<cassava.RouterResponse> {
    console.log("Received request:" + JSON.stringify(evt));
    const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
    metrics.histogram("turnkey.v2.giftcardpurchase", 1, [`mode:${auth.isTestUser() ? "test" : "live"}`]);
    metrics.flush();
    auth.requireIds("giftbitUserId");
    auth.requireScopes("lightrailV2:turnkey:purchase");

    const authorizeAs = auth.getAuthorizeAsPayload();
    const assumeToken = (await assumeGiftcardPurchaseToken).assumeToken;

    const {turnkeyConfig, merchantStripeConfig, lightrailStripeConfig} = await validateConfig(auth, assumeToken, authorizeAs);
    const params = GiftcardPurchaseParams.getFromRequest(evt);
    const chargeAndValueCoreMetadata = GiftcardPurchaseParams.getCoreMetadata(params);

    const usingSavedCard: boolean = params.stripeCardId !== null;
    let charge: Charge = await createStripeCharge({
        amount: params.initialValue,
        currency: turnkeyConfig.currency,
        source: usingSavedCard ? params.stripeCardId : params.stripeCardToken,
        receipt_email: params.senderEmail,
        metadata: chargeAndValueCoreMetadata,
        customer: usingSavedCard ? params.stripeCustomerId : undefined
    }, lightrailStripeConfig.secretKey, merchantStripeConfig.stripe_user_id);

    const passedFraudCheck = await passesFraudCheck(params, charge, evt);
    if (!passedFraudCheck) {
        await rollbackCharge(lightrailStripeConfig, merchantStripeConfig, charge, "The order failed fraud check.");
        throw new GiftbitRestError(cassava.httpStatusCode.clientError.BAD_REQUEST, "Failed to charge credit card.", "ChargeFailed");
    }

    let value: {id: string, code: string};
    try {
        const valueMetadata = {
            ...chargeAndValueCoreMetadata,
            charge_id: charge.id,
            "giftbit-note": {
                note: `charge_id: ${charge.id},
                sender: ${params.senderEmail},
                recipient: ${params.recipientEmail}`
            }
        };
        value = await createValue(assumeToken, authorizeAs, charge.id, params, turnkeyConfig, valueMetadata);
    } catch (err) {
        console.log(`An error occurred during Value creation. Error: status=${err.status} method=${err.response.req.method} url=${err.response.req.url} text=${err.response.text}.`);
        await rollbackCharge(lightrailStripeConfig, merchantStripeConfig, charge, "Refunded due to an unexpected error during gift card creation in Lightrail.");
        await rollbackCreateValue(assumeToken, authorizeAs, value);

        if (err.status === 400 || err.status === 409 || err.status === 422) {
            throw new cassava.RestError(cassava.httpStatusCode.clientError.BAD_REQUEST, err.body.message);
        } else {
            throw new cassava.RestError(cassava.httpStatusCode.serverError.INTERNAL_SERVER_ERROR);
        }
    }

    try {
        await updateStripeCharge(charge.id, {
            description: `${turnkeyConfig.companyName} gift card. Purchase reference number: ${value.id}.`,
            metadata: {...chargeAndValueCoreMetadata, lightrail_value_id: value.id}
        }, lightrailStripeConfig.secretKey, merchantStripeConfig.stripe_user_id);
        await emailGiftToRecipient({
            fullcode: value.code,
            recipientEmail: params.recipientEmail,
            message: params.message,
            senderName: params.senderName,
            initialValue: params.initialValue
        }, turnkeyConfig);
    } catch (err) {
        console.log(`An error occurred while attempting to deliver fullcode to recipient. Error: status=${err.status} method=${err.response.req.method} url=${err.response.req.url} text=${err.response.text}.`);
        await rollbackCharge(lightrailStripeConfig, merchantStripeConfig, charge, `Refunded due to an unexpected error during the gift card delivery step. The value ${value.id} will be cancelled in Lightrail.`);
        await rollbackCreateValue(assumeToken, authorizeAs, value);
        throw new GiftbitRestError(cassava.httpStatusCode.serverError.INTERNAL_SERVER_ERROR);
    }

    return {
        body: {
            valueId: value.id,
            stripeChargeId: charge.id
        }
    };
}

export async function deliverGiftcard(evt: cassava.RouterEvent): Promise<cassava.RouterResponse> {
    console.log("Received request for deliver gift card:" + JSON.stringify(evt));
    const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
    metrics.histogram("turnkey.v2.giftcarddeliver", 1, [`mode:${auth.isTestUser() ? "test" : "live"}`]);
    metrics.flush();
    auth.requireIds("giftbitUserId");
    auth.requireScopes("lightrailV2:turnkey:deliver");

    const authorizeAs = auth.getAuthorizeAsPayload();
    const assumeToken = (await assumeGiftcardDeliverToken).assumeToken;

    const params = DeliverGiftCardV2Params.getFromRequest(evt);

    const config: TurnkeyPublicConfig = await turnkeyConfigUtil.getConfig(assumeToken, authorizeAs);
    console.log(`Fetched public turnkey config: ${JSON.stringify(config)}`);
    validateTurnkeyConfig(config);

    const value = await getValueWithCodeById(assumeToken, authorizeAs, params.valueId);
    if (!value) {
        throw new GiftbitRestError(cassava.httpStatusCode.clientError.BAD_REQUEST, `parameter valueId did not correspond to a value`, "InvalidParamValueIdNoValueFound");
    }

    await updateValueRecipient(assumeToken, authorizeAs, value, params.recipientEmail);

    if (!params.message) {
        params.message = value.metadata ? value.metadata.message : null;
    }
    if (!params.senderName) {
        params.senderName = value.metadata ? value.metadata.sender_name : null;
    }

    try {
        await emailGiftToRecipient({
            fullcode: value.code,
            recipientEmail: params.recipientEmail,
            message: params.message,
            senderName: params.senderName,
            initialValue: value.balance
        }, config);
    } catch (err) {
        console.log(`An error occurred while attempting to deliver fullcode to recipient. Error: ${err}.`);
        throw new GiftbitRestError(cassava.httpStatusCode.serverError.INTERNAL_SERVER_ERROR);
    }

    return {
        body: {
            success: true,
            params: params
        }
    };
}

async function createValue(assumeToken: string, authorizeAs: string, valueId: string, params: GiftcardPurchaseParams, config: TurnkeyPublicConfig, metadata?: {[key: string]: any}): Promise<{id: string, code: string}> {
    const response = await superagent.agent()
        .post(`https://${process.env["LIGHTRAIL_DOMAIN"]}/v2/values?showCode=true`)
        .set("Authorization", `Bearer ${assumeToken}`)
        .set("AuthorizeAs", authorizeAs)
        .send({
            id: valueId,
            currency: config.currency,
            programId: config.programId,
            balance: params.initialValue,
            pretax: false,
            discount: false,
            generateCode: {},
            metadata: metadata
        });
    return response.body;
}

async function getValueWithCodeById(assumeToken: string, authorizeAs: string, valueId: string): Promise<{id: string, code: string, balance: number, metadata: {[key: string]: any}}> {
    const response = await superagent.agent()
        .get(`https://${process.env["LIGHTRAIL_DOMAIN"]}/v2/values/${encodeURIComponent(valueId)}?showCode=true`)
        .set("Authorization", `Bearer: ${assumeToken}`)
        .set("AuthorizeAs", authorizeAs)
        .ok(res => res.ok || res.status === 404);
    if (response.status === 404) {
        return null;
    }
    return response.body;
}

async function updateValueRecipient(assumeToken: string, authorizeAs: string, value: {id: string, metadata: {[key: string]: any}}, recipientEmail: string): Promise<void> {
    const metadata = {
        ...value.metadata,
        "giftbit-note": {
            ...value.metadata["giftbit-note"],
            recipient: recipientEmail
        }
    };

    await superagent.agent()
        .patch(`https://${process.env["LIGHTRAIL_DOMAIN"]}/v2/values/${encodeURIComponent(value.id)}`)
        .set("Authorization", `Bearer: ${assumeToken}`)
        .set("AuthorizeAs", authorizeAs)
        .send({
            metadata
        });
}

async function rollbackCreateValue(assumeToken: string, authorizeAs: string, value: {id: string}): Promise<void> {
    if (value) {
        await superagent.agent()
            .patch(`https://${process.env["LIGHTRAIL_DOMAIN"]}/v2/values/${value.id}`)
            .set("Authorization", `Bearer: ${assumeToken}`)
            .set("AuthorizeAs", authorizeAs)
            .send({
                canceled: true
            });
    }
}
