import * as chai from "chai";
import {isValidEmailAddress} from "./emailUtils";

describe("test email validator", () => {

    /**
     * Test cases from: https://blogs.msdn.microsoft.com/testing123/2009/02/06/email-address-test-cases/
     */
    const testCases = [
        {email: "email@domain.com", isValid: true, message: "Valid email"},
        {email: "firstname.lastname@domain.com", isValid: true, message: "Email contains dot in the address field"},
        {email: "email@subdomain.domain.com", isValid: true, message: "Email contains dot with subdomain"},
        {email: "firstname+lastname@domain.com", isValid: true, message: "Plus sign is considered valid character"},
        {
            email: "email@[123.123.123.123]",
            isValid: true,
            message: "Square bracket around IP address is considered valid"
        },
        {email: "\"email\"@domain.com", isValid: true, message: "Quotes around email is considered valid"},
        {email: "1234567890@domain.com", isValid: true, message: "Digits in address are valid"},
        {email: "email@domain-one.com", isValid: true, message: "Dash in domain name is valid"},
        {email: "_______@domain.com", isValid: true, message: "Underscore in the address field is valid"},
        {email: "email@domain.name", isValid: true, message: ".name is valid Top Level Domain name"},
        {
            email: "email@domain.co.jp",
            isValid: true,
            message: "Dot in Top Level Domain name also considered valid (use co.jp as example here)"
        },
        {email: "tim+SEND@giftbit.com", isValid: true, message: "Capitals and plus signs are okay."},
        {email: "TIM+SEND@giftbit.com", isValid: true, message: "Capitals and plus signs are okay."},
        {email: "firstname-lastname@domain.com", isValid: true, message: "Dash in address field is valid"},
        {email: "plainaddress", isValid: false, message: "Missing @ sign and domain"},
        {email: "#@%^%#$@#$@#.com", isValid: false, message: "Garbage"},
        {email: "@domain.com", isValid: false, message: "Missing username"},
        {email: "email.domain.com", isValid: false, message: "Missing @"},
        {email: "email.@domain.com", isValid: false, message: "Trailing dot in address is not allowed"},
        {email: "email@domain", isValid: false, message: "Missing top level domain (.com/.net/.org/etc)"},
        {email: "email@domain..com", isValid: false, message: "Multiple dot in the domain portion is invalid"},
    ];

    describe("is valid", () => {
        testCases.filter(t => t.isValid)
            .forEach(t => it(t.message, () => chai.assert.isTrue(isValidEmailAddress(t.email))));
    });

    describe("is not valid", () => {
        testCases.filter(t => !t.isValid)
            .forEach(t => it(t.message, () => chai.assert.isFalse(isValidEmailAddress(t.email))));
    });
});
