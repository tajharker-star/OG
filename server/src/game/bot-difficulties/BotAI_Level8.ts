import { BotAI } from '../BotAI';
import { createBotStrategyProfile } from './BotStrategyProfile';

export const BOT_AI_LEVEL_8_PROFILE = createBotStrategyProfile(8, {
    controllerId: 'level-8-coordinator'
});

export class BotAI_Level8 extends BotAI {
    constructor(playerId: string) {
        super(playerId, 8, BOT_AI_LEVEL_8_PROFILE);
    }
}
