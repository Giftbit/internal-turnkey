export class StripeChargeError extends Error {

    error: Error;

    constructor(err: Error) {
        super(err.message);
        this.error = err;
    }
}
