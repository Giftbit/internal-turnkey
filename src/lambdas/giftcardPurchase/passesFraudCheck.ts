import * as cassava from "cassava";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as lambdaComsLib from "giftbit-lambda-comslib";
import {getMinfraudParamsForGiftcardPurchase} from "../../utils/giftcardPurchaseFraudCheckUtils";
import {MinfraudScoreResult} from "../../utils/minfraud/MinfraudScoreResult";
import {Charge} from "../../utils/stripedtos/Charge";
import {GiftcardPurchaseParams} from "./GiftcardPurchaseParams";
import {MinfraudScoreParams} from "../../utils/minfraud/MinfraudScoreParams";
import {getScore} from "../../utils/minfraud/minfraudUtils";
import {MinfraudConfig} from "../../utils/minfraud/MinfraudConfig";

const minfraudConfigPromise = giftbitRoutes.secureConfig.fetchFromS3ByEnvVar<MinfraudConfig>("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_MINFRAUD");

export async function passesFraudCheck(giftcardPurchaseParams: GiftcardPurchaseParams, charge: Charge, request: cassava.RouterEvent): Promise<boolean> {
    const auth: giftbitRoutes.jwtauth.AuthorizationBadge = request.meta["auth"];
    const passedStripeCheck = passesStripeCheck(charge);

    const minfraudScoreParams: MinfraudScoreParams = getMinfraudParamsForGiftcardPurchase({
        request: request,
        charge: charge,
        userId: auth.merchantId,
        recipientEmail: giftcardPurchaseParams.recipientEmail,
        name: giftcardPurchaseParams.senderName
    });
    let minfraudScore: MinfraudScoreResult;

    if (!auth.isTestUser()) {
        try {
            minfraudScore = await getScore(minfraudScoreParams, minfraudConfigPromise);
        } catch (err) {
            console.log(`Unexpected error occurred during fraud check. Simply logging the exception and carrying on with request. ${err}`);
        }
    }
    let passedMinfraudCheck = passesMinfraudCheck(minfraudScore);

    const passedFraudCheck = passedStripeCheck && passedMinfraudCheck;
    const messagePayload = {
        giftcardPurchaseParams: giftcardPurchaseParams,
        minfraudScoreParams: minfraudScoreParams,
        minfraudScore: minfraudScore,
        passedFraudCheck: passedFraudCheck
    };
    try {
        console.log(`Sending event on kinesis stream: id: ${charge.id}, payload: ${JSON.stringify(messagePayload)}.`);
        await lambdaComsLib.putMessage("event.dropingiftcard.purchase.fraudcheck", charge.id, messagePayload, lambdaComsLib.kinesisStreamArnToName(process.env["KINESIS_STREAM_ARN"]));
    } catch (err) {
        console.log(`Exception ${err} occurred while attempting to put ${JSON.stringify(messagePayload)} on kinesis stream. Kinesis Stream Arn = ${process.env["KINESIS_STREAM_ARN"]}.`);
    }
    return passedFraudCheck;
}

function passesMinfraudCheck(minfraudScore: MinfraudScoreResult): boolean {
    if (!minfraudScore) {
        console.log("No minfraud score received. Skipping check.");
        return true;
    } else {
        if (minfraudScore.riskScore > 70 || minfraudScore.ipRiskScore > 70 /* The range is [0.1-99] and represents the likelihood of the purchase being fraudulent. 70 = 70% likely to be fraudulent. */) {
            console.log("Minfraud score above allowed range.");
            return false;
        } else {
            console.log("Minfraud score was within allowed range.");
            return true;
        }
    }
}

function passesStripeCheck(charge: Charge): boolean {
    return !charge.review;
}
