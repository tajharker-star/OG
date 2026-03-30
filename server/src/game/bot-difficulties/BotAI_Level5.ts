import { BotAI } from '../BotAI';
import { createBotStrategyProfile } from './BotStrategyProfile';

export const BOT_AI_LEVEL_5_PROFILE = createBotStrategyProfile(5, {
    controllerId: 'level-5-balanced'
});

export class BotAI_Level5 extends BotAI {
    constructor(playerId: string) {
        super(playerId, 5, BOT_AI_LEVEL_5_PROFILE);
    }
}
