import {TurnkeyPublicConfig, validatePublicTurnkeyConfig} from "./TurnkeyPublicConfig";
import {TurnkeyPrivateConfig, validatePrivateTurnkeyConfig} from "./TurnkeyPrivateConfig";

export interface TurnkeyConfig {
    publicConfig: TurnkeyPublicConfig;
    privateConfig: TurnkeyPrivateConfig
}

export function validateTurnkeyConfig(config: TurnkeyConfig): void {
    validatePublicTurnkeyConfig(config.publicConfig);
    validatePrivateTurnkeyConfig(config.privateConfig);
}