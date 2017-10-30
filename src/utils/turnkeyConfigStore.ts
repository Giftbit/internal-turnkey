import {TurnkeyPublicConfig} from "./TurnkeyPublicConfig";
import {TurnkeyPrivateConfig} from "./TurnkeyPrivateConfig";
import * as storageUtils from "./storageUtils";

const TURNKEY_PUBLIC_CONFIG_KEY = "turnkey_public_config";
const TURNKEY_PRIVATE_CONFIG_KEY = "turnkey_private_config";

export async function getPublicConfig(apiKey: string): Promise<TurnkeyPublicConfig> {
    return await storageUtils.getKey(TURNKEY_PUBLIC_CONFIG_KEY, apiKey) as TurnkeyPublicConfig
}

export async function getPrivateConfig(apiKey: string): Promise<TurnkeyPrivateConfig> {
    return await storageUtils.getKey(TURNKEY_PRIVATE_CONFIG_KEY, apiKey) as TurnkeyPrivateConfig
}

