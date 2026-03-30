import { BotAI } from '../BotAI';
import { createBotStrategyProfile } from './BotStrategyProfile';

export const BOT_AI_LEVEL_3_PROFILE = createBotStrategyProfile(3, {
    controllerId: 'level-3-defender'
});

export class BotAI_Level3 extends BotAI {
    constructor(playerId: string) {
        super(playerId, 3, BOT_AI_LEVEL_3_PROFILE);
    }
}
