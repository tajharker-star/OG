import { BotAI } from '../BotAI';
import { createBotStrategyProfile } from './BotStrategyProfile';

export const BOT_AI_LEVEL_4_PROFILE = createBotStrategyProfile(4, {
    controllerId: 'level-4-balanced'
});

export class BotAI_Level4 extends BotAI {
    constructor(playerId: string) {
        super(playerId, 4, BOT_AI_LEVEL_4_PROFILE);
    }
}
