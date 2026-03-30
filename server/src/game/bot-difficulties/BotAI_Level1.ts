import { BotAI } from '../BotAI';
import { createBotStrategyProfile } from './BotStrategyProfile';

export const BOT_AI_LEVEL_1_PROFILE = createBotStrategyProfile(1, {
    controllerId: 'level-1-defender'
});

export class BotAI_Level1 extends BotAI {
    constructor(playerId: string) {
        super(playerId, 1, BOT_AI_LEVEL_1_PROFILE);
    }
}
