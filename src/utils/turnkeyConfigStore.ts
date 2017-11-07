import {TurnkeyConfig} from "./TurnkeyConfig";
import * as kvsAccess from "./kvsAccess";

const TURNKEY_PUBLIC_CONFIG_KEY = "turnkeyPublicConfig";

export async function getConfig(apiKey: string): Promise<TurnkeyConfig> {
    return await kvsAccess.kvsGet(apiKey, TURNKEY_PUBLIC_CONFIG_KEY) as TurnkeyConfig
}
