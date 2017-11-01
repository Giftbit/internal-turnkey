import {TurnkeyPublicConfig} from "./TurnkeyPublicConfig";
import {TurnkeyPrivateConfig} from "./TurnkeyPrivateConfig";
import * as kvsAccess from "./kvsAccess";
import {TurnkeyConfig} from "./TurnkeyConfig";

const TURNKEY_PUBLIC_CONFIG_KEY = "turnkey_public_config";
const TURNKEY_PRIVATE_CONFIG_KEY = "turnkey_private_config";

export async function getPublicConfig(apiKey: string): Promise<TurnkeyPublicConfig> {
    return await kvsAccess.kvsGet(apiKey, TURNKEY_PUBLIC_CONFIG_KEY) as TurnkeyPublicConfig
}

export async function getPrivateConfig(apiKey: string): Promise<TurnkeyPrivateConfig> {
    return await kvsAccess.kvsGet(apiKey, TURNKEY_PRIVATE_CONFIG_KEY) as TurnkeyPrivateConfig
}

export async function getConfig(apiKey: string): Promise<TurnkeyConfig> {
    return {
        publicConfig: await getPublicConfig(apiKey),
        privateConfig: await getPrivateConfig(apiKey)
    }
}