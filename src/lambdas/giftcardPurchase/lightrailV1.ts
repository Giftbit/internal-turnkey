import * as lightrail from "lightrail-client";
import * as uuid from "uuid";
import {Card, Contact} from "lightrail-client/dist/model";
import {TurnkeyPublicConfig, validateTurnkeyConfig} from "../../utils/TurnkeyConfig";
import {GiftcardPurchaseParams} from "./GiftcardPurchaseParams";
import {CreateCardParams, CreateContactParams} from "lightrail-client/dist/params";
import * as cassava from "cassava";
import {passesFraudCheck} from "./passesFraudCheck";
import {GiftbitRestError} from "giftbit-cassava-routes/dist/GiftbitRestError";
import * as giftbitRoutes from "giftbit-cassava-routes";
import {Charge} from "../../utils/stripedtos/Charge";
import {emailGiftToRecipient} from "./emailGiftToRecipient";
import * as metrics from "giftbit-lambda-metricslib";
import * as turnkeyConfigUtil from "../../utils/turnkeyConfigStore";
import {DeliverGiftCardV1Params} from "./DeliverGiftCardParams";
import {validateConfig} from "./validateConfig";
import {createStripeCharge, rollbackCharge, updateStripeCharge} from "../../utils/stripeAccess";
import {formatCurrency} from "../../utils/currencyUtils";

export const assumeGiftcardPurchaseToken = giftbitRoutes.secureConfig.fetchFromS3ByEnvVar<giftbitRoutes.secureConfig.AssumeScopeToken>("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_ASSUME_GIFTCARD_PURCHASE_TOKEN");
export const assumeGiftcardDeliverToken = giftbitRoutes.secureConfig.fetchFromS3ByEnvVar<giftbitRoutes.secureConfig.AssumeScopeToken>("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_ASSUME_GIFTCARD_DELIVER_TOKEN");

export async function purchaseGiftcard(evt: cassava.RouterEvent): Promise<cassava.RouterResponse> {
    console.log("Received request:" + JSON.stringify(evt));
    const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
    metrics.histogram("turnkey.v1.giftcardpurchase", 1, [`mode:${auth.isTestUser() ? "test" : "live"}`]);
    metrics.flush();
    auth.requireIds("giftbitUserId");
    auth.requireScopes("lightrailV1:purchaseGiftcard");

    const authorizeAs = auth.getAuthorizeAsPayload();
    const assumeToken = (await assumeGiftcardPurchaseToken).assumeToken;
    lightrail.configure({
        apiKey: assumeToken,
        restRoot: "https://" + process.env["LIGHTRAIL_DOMAIN"] + "/v1/",
        logRequests: true,
        additionalHeaders: {AuthorizeAs: authorizeAs}
    });

    const {turnkeyConfig, merchantStripeConfig, lightrailStripeConfig} = await validateConfig(auth, assumeToken, authorizeAs);
    const params = GiftcardPurchaseParams.getFromRequest(evt);
    const chargeAndCardCoreMetadata = GiftcardPurchaseParams.getCoreMetadata(params);

    const usingSavedCard: boolean = params.stripeCardId !== null;
    let charge: Charge = await createStripeCharge({
        amount: params.initialValue,
        currency: turnkeyConfig.currency,
        source: usingSavedCard ? params.stripeCardId : params.stripeCardToken,
        receipt_email: params.senderEmail,
        metadata: chargeAndCardCoreMetadata,
        customer: usingSavedCard ? params.stripeCustomerId : undefined
    }, lightrailStripeConfig.secretKey, merchantStripeConfig.stripe_user_id);

    const passedFraudCheck = await passesFraudCheck(params, charge, evt);
    if (!passedFraudCheck) {
        await rollbackCharge(lightrailStripeConfig, merchantStripeConfig, charge, "The order failed fraud check.");
        throw new GiftbitRestError(cassava.httpStatusCode.clientError.BAD_REQUEST, "Failed to charge credit card.", "ChargeFailed");
    }

    let card: lightrail.model.Card;
    try {
        const cardMetadata = {
            ...chargeAndCardCoreMetadata,
            charge_id: charge.id,
            "giftbit-note": {
                note: `charge_id: ${charge.id},
                sender: ${params.senderEmail},
                recipient: ${params.recipientEmail}`
            }
        };
        card = await createCard(charge.id, params, turnkeyConfig, cardMetadata);
    } catch (err) {
        console.log(`An error occurred during card creation. Error: ${JSON.stringify(err)}.`);
        await rollbackCharge(lightrailStripeConfig, merchantStripeConfig, charge, "Refunded due to an unexpected error during gift card creation in Lightrail.");
        await rollbackCreateCard(card);

        if (err.status === 400) {
            throw new cassava.RestError(cassava.httpStatusCode.clientError.BAD_REQUEST, err.message);
        } else {
            throw new cassava.RestError(cassava.httpStatusCode.serverError.INTERNAL_SERVER_ERROR);
        }
    }

    try {
        await updateStripeCharge(charge.id, {
            description: `${turnkeyConfig.companyName} gift card. Purchase reference number: ${card.cardId}.`,
            metadata: {...chargeAndCardCoreMetadata, lightrail_gift_card_id: card.cardId}
        }, lightrailStripeConfig.secretKey, merchantStripeConfig.stripe_user_id);
        await emailGiftToRecipient({
            fullcode: (await lightrail.cards.getFullcode(card.cardId)).code,
            recipientEmail: params.recipientEmail,
            message: params.message,
            senderName: params.senderName,
            initialValue: formatCurrency(params.initialValue, turnkeyConfig.currency)
        }, turnkeyConfig);
    } catch (err) {
        console.log(`An error occurred while attempting to deliver fullcode to recipient. Error: ${err}.`);
        await rollbackCharge(lightrailStripeConfig, merchantStripeConfig, charge, `Refunded due to an unexpected error during the gift card delivery step. The gift card ${card.cardId} will be cancelled in Lightrail.`);
        await rollbackCreateCard(card);
        throw new GiftbitRestError(cassava.httpStatusCode.serverError.INTERNAL_SERVER_ERROR);
    }

    return {
        body: {
            cardId: card.cardId
        }
    };
}

export async function deliverGiftcard(evt: cassava.RouterEvent): Promise<cassava.RouterResponse> {
    console.log("Received request for deliver gift card:" + JSON.stringify(evt));
    const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
    metrics.histogram("turnkey.v1.giftcarddeliver", 1, [`mode:${auth.isTestUser() ? "test" : "live"}`]);
    metrics.flush();
    auth.requireIds("giftbitUserId");
    auth.requireScopes("lightrailV1:card:deliver");

    const authorizeAs = auth.getAuthorizeAsPayload();
    const assumeToken = (await assumeGiftcardDeliverToken).assumeToken;
    lightrail.configure({
        apiKey: assumeToken,
        restRoot: "https://" + process.env["LIGHTRAIL_DOMAIN"] + "/v1/",
        logRequests: true,
        additionalHeaders: {AuthorizeAs: authorizeAs}
    });

    const params = DeliverGiftCardV1Params.getFromRequest(evt);

    const config: TurnkeyPublicConfig = await turnkeyConfigUtil.getConfig(assumeToken, authorizeAs);
    console.log(`Fetched public turnkey config: ${JSON.stringify(config)}`);
    validateTurnkeyConfig(config);

    const transactionsResp = await lightrail.cards.transactions.getTransactions(params.cardId, {transactionType: "INITIAL_VALUE"});
    const transaction = transactionsResp.transactions[0];
    console.log("Retrieved transaction:", JSON.stringify(transaction));

    const card = await lightrail.cards.getCardById(params.cardId);
    if (!card) {
        throw new GiftbitRestError(cassava.httpStatusCode.clientError.BAD_REQUEST, `parameter cardId did not correspond to a card`, "InvalidParamCardIdNoCardFound");
    }
    if (card.cardType !== "GIFT_CARD") {
        console.log(`Gift card deliver endpoint called with a card that is not of type GIFT_CARD. card: ${JSON.stringify(card)}.`);
        throw new GiftbitRestError(cassava.httpStatusCode.clientError.BAD_REQUEST, `parameter cardId must be for a GIFT_CARD`, "InvalidParamCardId");
    }

    await changeContact(card, params.recipientEmail);

    if (!params.message) {
        params.message = transaction.metadata ? transaction.metadata.message : null;
    }
    if (!params.senderName) {
        params.senderName = transaction.metadata ? transaction.metadata.sender_name : null;
    }

    try {
        await emailGiftToRecipient({
            fullcode: (await lightrail.cards.getFullcode(card.cardId)).code,
            recipientEmail: params.recipientEmail,
            message: params.message,
            senderName: params.senderName,
            initialValue: formatCurrency(transaction.value, config.currency)
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

async function createCard(userSuppliedId: string, params: GiftcardPurchaseParams, config: TurnkeyPublicConfig, metadata?: object): Promise<Card> {
    const contact = await getOrCreateContact(params.recipientEmail);
    console.log(`Got contact ${JSON.stringify(contact)}`);

    const cardParams: CreateCardParams = {
        userSuppliedId: userSuppliedId,
        cardType: Card.CardType.GIFT_CARD,
        contactId: contact.contactId,
        initialValue: params.initialValue,
        programId: config.programId,
        metadata: metadata
    };
    console.log(`Creating card with params ${JSON.stringify(cardParams)}.`);
    const card: Card = await lightrail.cards.createCard(cardParams);
    console.log(`Created card ${JSON.stringify(card)}.`);
    return card;
}

async function getOrCreateContact(email: string): Promise<Contact> {
    const contacts = await lightrail.contacts.getContacts({email: email});
    if (contacts.contacts.length > 0) {
        console.log(`Found existing contact ${JSON.stringify(contacts.contacts[0])} to set `);
        return contacts.contacts[0];
    } else {
        const contactParams: CreateContactParams = {
            userSuppliedId: uuid.v4().replace(/-/g, ""),
            email: email
        };
        console.log(`Creating contact with params ${JSON.stringify(contactParams)}`);
        return await lightrail.contacts.createContact(contactParams);
    }
}

async function changeContact(card: Card, recipientEmail: string): Promise<void> {
    const contact = await getOrCreateContact(recipientEmail);
    await lightrail.cards.updateCard(card, {contactId: contact.contactId});
}

async function rollbackCreateCard(card: lightrail.model.Card): Promise<void> {
    if (card) {
        const cancel = await lightrail.cards.cancelCard(card, card.cardId + "-cancel");
        console.log(`Cancelled card ${card.cardId}. Cancel response: ${cancel}.`);
    }
}
