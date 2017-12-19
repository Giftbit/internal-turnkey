import * as superagent from "superagent";
import {MinfraudScoreParams} from "./MinfraudScoreParams";
import {MinfraudConfig} from "./MinfraudConfig";
import {MinfraudScoreResult} from "./MinfraudScoreResult";

/**
 * Returns
 * - riskScore: [0.1-99]
 * - ipRiskScore: [0.1-99]
 */
export async function getScore(minfraudScoreParams: MinfraudScoreParams, minfraudConfigPromise: Promise<MinfraudConfig>): Promise<MinfraudScoreResult> {
    const minfraudConfig = await minfraudConfigPromise;
    let minfraudConfigSanitized = {
        userId: minfraudConfig.userId,
        licenseKey: "hidden",
        doMinfraudCheck: minfraudConfig.doMinfraudCheck
    };
    console.log(`minfraud config: ${JSON.stringify(minfraudConfigSanitized)}`);
    if (minfraudConfig.doMinfraudCheck) {
        console.log(`Preforming minfraud check. Params: ${JSON.stringify(minfraudScoreParams)}`);
        const auth = Buffer.from(`${minfraudConfig.userId}:${minfraudConfig.licenseKey}`).toString("base64");
        const resp = await superagent.post("https://minfraud.maxmind.com/minfraud/v2.0/score")
            .set("Authorization", `Basic ${auth}`)
            .send(minfraudScoreParams);
        console.log(`Minfraud result: ${JSON.stringify(resp.body)}`);
        return {
            riskScore: resp.body.risk_score,
            ipRiskScore: resp.body.ip_address.riskScore
        };
    } else {
        console.log("Skipping minfraud check since config is set to skip. Returning minimum risk scores");
        return {
            riskScore: 0.1,
            ipRiskScore: 0.1
        }
    }
}