import { BotAI } from '../BotAI';
import { createBotStrategyProfile } from './BotStrategyProfile';

export const BOT_AI_LEVEL_7_PROFILE = createBotStrategyProfile(7, {
    controllerId: 'level-7-coordinator'
});

export class BotAI_Level7 extends BotAI {
    constructor(playerId: string) {
        super(playerId, 7, BOT_AI_LEVEL_7_PROFILE);
    }
}
