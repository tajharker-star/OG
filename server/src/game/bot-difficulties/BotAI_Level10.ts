import { BotAI } from '../BotAI';
import { createBotStrategyProfile } from './BotStrategyProfile';

export const BOT_AI_LEVEL_10_PROFILE = createBotStrategyProfile(10, {
    controllerId: 'level-10-overmind'
});

export class BotAI_Level10 extends BotAI {
    constructor(playerId: string) {
        super(playerId, 10, BOT_AI_LEVEL_10_PROFILE);
    }
}
