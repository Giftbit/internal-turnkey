import * as chai from "chai";
import {GiftbitRestError} from "giftbit-cassava-routes";
import {createStripeCharge, getStripeClient} from "./stripeAccess";
import Stripe = require("stripe");

describe("stripeAccess", () => {

    let merchantAccount: Stripe.accounts.IAccount;

    before(async () => {
        merchantAccount = await getStripeClient("sk_test_abcdefg").accounts.create({type: "custom"});
    });

    describe("createStripeCharge()", () => {
        it("throws a GiftbitRestError on fraudulent cards", async () => {
            let err: GiftbitRestError = null;
            try {
                await createStripeCharge(
                    {
                        amount: 5000,
                        currency: "cad",
                        source: "tok_chargeDeclinedFraudulent"
                    },
                    "sk_test_abcdefg",
                    merchantAccount.id
                );
            } catch (error) {
                err = error;
            }
            chai.assert.instanceOf(err, GiftbitRestError);
            chai.assert.equal(err.statusCode, 409);
            chai.assert.equal(err.additionalParams.messageCode, "ChargeFailed");
        });

        it("throws a GiftbitRestError on incorrect cvc", async () => {
            let err: GiftbitRestError = null;
            try {
                await createStripeCharge(
                    {
                        amount: 5000,
                        currency: "cad",
                        source: "tok_chargeDeclinedIncorrectCvc"
                    },
                    "sk_test_abcdefg",
                    merchantAccount.id
                );
            } catch (error) {
                err = error;
            }
            chai.assert.instanceOf(err, GiftbitRestError);
            chai.assert.equal(err.statusCode, 409);
            chai.assert.equal(err.additionalParams.messageCode, "ChargeFailed");
        });
    });
});
