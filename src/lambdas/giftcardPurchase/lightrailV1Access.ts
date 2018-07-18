import * as lightrail from "lightrail-client";
import * as uuid from "uuid";
import {Card, Contact} from "lightrail-client/dist/model";
import {TurnkeyPublicConfig} from "../../utils/TurnkeyConfig";
import {GiftcardPurchaseParams} from "./GiftcardPurchaseParams";
import {CreateCardParams, CreateContactParams} from "lightrail-client/dist/params";

export async function createCard(userSuppliedId: string, params: GiftcardPurchaseParams, config: TurnkeyPublicConfig, metadata?: any): Promise<Card> {
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

export async function changeContact(card: Card, recipientEmail: string): Promise<void> {
    const contact = await getOrCreateContact(recipientEmail);
    await lightrail.cards.updateCard(card, {contactId: contact.contactId});
}
