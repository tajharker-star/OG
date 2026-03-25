import { BotAI } from '../BotAI';
import { createBotStrategyProfile } from './BotStrategyProfile';

export const BOT_AI_LEVEL_2_PROFILE = createBotStrategyProfile(2, {
    controllerId: 'level-2-defender'
});

export class BotAI_Level2 extends BotAI {
    constructor(playerId: string) {
        super(playerId, 2, BOT_AI_LEVEL_2_PROFILE);
    }
}
