import { BotAI } from '../BotAI';
import { createBotStrategyProfile } from './BotStrategyProfile';

export const BOT_AI_LEVEL_6_PROFILE = createBotStrategyProfile(6, {
    controllerId: 'level-6-balanced'
});

export class BotAI_Level6 extends BotAI {
    constructor(playerId: string) {
        super(playerId, 6, BOT_AI_LEVEL_6_PROFILE);
    }
}
