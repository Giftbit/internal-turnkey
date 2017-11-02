import {GiftcardPurchaseParams} from "./GiftcardPurchaseParams";
import {Card} from "lightrail-client/dist/model";

export async function createChargeOnBehalfOfMerchant(requestParams: GiftcardPurchaseParams, currency: string, lightrailStripeSecretKey: string, merchantStripeAccountId: string): Promise<any> {
    const lightrailStripe = require("stripe")(lightrailStripeSecretKey);

    console.log(`Attempting to charge card on behalf of merchant.`);
    // Charge the user's card:
    return lightrailStripe.charges.create({
        amount: requestParams.initialValue,
        currency: currency,
        description: "Charge for gift card.",
        source: requestParams.stripeCardToken,
        destination: {
            account: merchantStripeAccountId
        }
    });
}

export async function retrieveTransfer(charge: any, lightrailStripeSecretKey: string) {
    const lightrailStripe = require("stripe")(lightrailStripeSecretKey);
    return lightrailStripe.transfers.retrieve(
        charge.transfer
    );
}

export async function updateCharge(paymentId: string, card: Card, merchantStripeSecretKet: string): Promise<any> {
    const merchantStripe = require("stripe")(merchantStripeSecretKet);
    console.log(`Attempting to update metadata.`);
    // Charge the user's card:
    return merchantStripe.charges.update(
        paymentId,
        {
            description: "Lightrail Gift Card",
            metadata: {
                cardId: card.cardId,
            }
        });
}

export async function createRefund(charge: any, lightrailStripeSecret: string): Promise<any> {
    const lightrailStripe = require("stripe")(lightrailStripeSecret);
    console.log(`Attempting to create refund.`);
    // Charge the user's card:
    return lightrailStripe.refunds.create({
        charge: charge.id,
        reverse_transfer: true,
        metadata: {"explanation": "The Lightrail Gift Card could not be issued due to technical reasons."}
    });
}