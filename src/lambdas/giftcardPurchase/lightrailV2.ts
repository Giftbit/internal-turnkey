import * as cassava from "cassava";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as metrics from "giftbit-lambda-metricslib";
import * as superagent from "superagent";
import {validateConfig} from "./validateConfig";
import {GiftcardPurchaseParams} from "./GiftcardPurchaseParams";
import {createCharge, rollbackCharge, updateCharge} from "../../utils/stripeAccess";
import {Charge} from "../../utils/stripedtos/Charge";
import {passesFraudCheck} from "./passesFraudCheck";
import {GiftbitRestError} from "giftbit-cassava-routes/dist/GiftbitRestError";
import {TurnkeyPublicConfig} from "../../utils/TurnkeyConfig";
import * as uuid from "uuid";
import {emailGiftToRecipient} from "./emailGiftToRecipient";

// TODO probably need to redo these for v2
const assumeGiftcardPurchaseToken = giftbitRoutes.secureConfig.fetchFromS3ByEnvVar<giftbitRoutes.secureConfig.AssumeScopeToken>("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_ASSUME_GIFTCARD_PURCHASE_TOKEN");
const assumeGiftcardDeliverToken = giftbitRoutes.secureConfig.fetchFromS3ByEnvVar<giftbitRoutes.secureConfig.AssumeScopeToken>("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_ASSUME_GIFTCARD_DELIVER_TOKEN");

export async function purchaseGiftcard(evt: cassava.RouterEvent): Promise<cassava.RouterResponse> {
    console.log("Received request:" + JSON.stringify(evt));
    const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
    metrics.histogram("turnkey.giftcardpurchase", 1, [`mode:${auth.isTestUser() ? "test" : "live"}`]);
    metrics.flush();
    auth.requireIds("giftbitUserId");
    auth.requireScopes("lightrailV2:purchaseGiftcard");

    const authorizeAs = auth.getAuthorizeAsPayload();
    const assumeToken = (await assumeGiftcardPurchaseToken).assumeToken;

    const {config, merchantStripeConfig, lightrailStripeConfig} = await validateConfig(auth, assumeToken, authorizeAs);
    const params = GiftcardPurchaseParams.getFromRequest(evt);
    const chargeAndValueCoreMetadata = GiftcardPurchaseParams.getCoreMetadata(params);

    const usingSavedCard: boolean = params.stripeCardId !== null;
    let charge: Charge = await createCharge({
        amount: params.initialValue,
        currency: config.currency,
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
        value = await createValue(assumeToken, authorizeAs, charge.id, params, config, valueMetadata);
    } catch (err) {
        console.log(`An error occurred during card creation. Error: ${JSON.stringify(err)}.`);
        await rollbackCharge(lightrailStripeConfig, merchantStripeConfig, charge, "Refunded due to an unexpected error during gift card creation in Lightrail.");
        await rollbackCreateValue(assumeToken, authorizeAs, value);

        if (err.status === 400 || err.status === 409 || err.status === 422) {
            throw new cassava.RestError(cassava.httpStatusCode.clientError.BAD_REQUEST, err.body.message);
        } else {
            throw new cassava.RestError(cassava.httpStatusCode.serverError.INTERNAL_SERVER_ERROR);
        }
    }

    try {
        await updateCharge(charge.id, {
            description: `${config.companyName} gift card. Purchase reference number: ${value.id}.`,
            metadata: {...chargeAndValueCoreMetadata, lightrail_value_id: value.id}
        }, lightrailStripeConfig.secretKey, merchantStripeConfig.stripe_user_id);
        await emailGiftToRecipient({
            fullcode: value.code,
            recipientEmail: params.recipientEmail,
            message: params.message,
            senderName: params.senderName,
            initialValue: params.initialValue
        }, config);
    } catch (err) {
        console.log(`An error occurred while attempting to deliver fullcode to recipient. Error: ${err}.`);
        await rollbackCharge(lightrailStripeConfig, merchantStripeConfig, charge, `Refunded due to an unexpected error during the gift card delivery step. The gift card ${card.cardId} will be cancelled in Lightrail.`);
        await rollbackCreateValue(assumeToken, authorizeAs, value);
        throw new GiftbitRestError(cassava.httpStatusCode.serverError.INTERNAL_SERVER_ERROR);
    }

    return {
        body: {
            valueId: value.id
        }
    };
}

export async function deliverGiftcard(evt: cassava.RouterEvent): Promise<cassava.RouterResponse> {
    throw new Error("not implemented");
}

async function createValue(assumeToken: string, authorizeAs: string, valueId: string, params: GiftcardPurchaseParams, config: TurnkeyPublicConfig, metadata?: object): Promise<{id: string, code: string}> {
    const response = await superagent.agent()
        .post(`https://${process.env["LIGHTRAIL_DOMAIN"]}/v2/values`)
        .set("Authorization", `Bearer: ${assumeToken}`)
        .set("AuthorizeAs", authorizeAs)
        .send({
            id: valueId,
            currency: "",   // TODO
            balance: params.initialValue,
            preTax: false,
            discount: false,
            generateCode: {
                length: 16,
                characters: "ABCEDFGHJKLMNPQRSTUVWXYZ3456789"
            }
        });
    return response.body;
}

async function getOrCreateContact(assumeToken: string, authorizeAs: string, email: string): Promise<{id: string}> {
    const getContactsByEmailResponse = await superagent.agent()
        .get(`https://${process.env["LIGHTRAIL_DOMAIN"]}/v2/contacts?email=${encodeURIComponent(email)}`)
        .set("Authorization", `Bearer: ${assumeToken}`)
        .set("AuthorizeAs", authorizeAs);
    if (getContactsByEmailResponse.body.length > 0) {
        console.log(`Found existing contact ${JSON.stringify(getContactsByEmailResponse.body[0])} to set `);
        return getContactsByEmailResponse.body[0];
    }

    const createContactResponse = await superagent.agent()
        .post(`https://${process.env["LIGHTRAIL_DOMAIN"]}/v2/contacts`)
        .set("Authorization", `Bearer: ${assumeToken}`)
        .set("AuthorizeAs", authorizeAs)
        .send({
            id: uuid.v4().replace(/-/g, ""),
            email: email
        });
    return createContactResponse.body;
}

async function changeContact(assumeToken: string, authorizeAs: string, valueId: string, recipientEmail: string): Promise<void> {
    const contact = await getOrCreateContact(assumeToken, authorizeAs, recipientEmail);

    await superagent.agent()
        .patch(`https://${process.env["LIGHTRAIL_DOMAIN"]}/v2/contacts/${encodeURIComponent(contact.id)}/values/attach`)
        .set("Authorization", `Bearer: ${assumeToken}`)
        .set("AuthorizeAs", authorizeAs)
        .send({
            valueId: valueId
        });
}

async function rollbackCreateValue(assumeToken: string, authorizeAs: string, value: {id: string}): Promise<void> {
    if (value) {
        await superagent.agent()
            .patch(`https://${process.env["LIGHTRAIL_DOMAIN"]}/v2/values`)
            .set("Authorization", `Bearer: ${assumeToken}`)
            .set("AuthorizeAs", authorizeAs)
            .send({
                canceled: true
            });
    }
}
