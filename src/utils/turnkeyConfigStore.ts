import {TurnkeyPublicConfig} from "./TurnkeyConfig";
import * as kvsAccess from "./kvsAccess";

export const TURNKEY_PUBLIC_CONFIG_KEY = "turnkeyPublicConfig";

export async function getConfig(apiKey: string): Promise<TurnkeyPublicConfig> {
    return await kvsAccess.kvsGet(apiKey, TURNKEY_PUBLIC_CONFIG_KEY) as TurnkeyPublicConfig;
}
