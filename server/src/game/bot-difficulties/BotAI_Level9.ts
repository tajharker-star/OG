import { BotAI } from '../BotAI';
import { createBotStrategyProfile } from './BotStrategyProfile';

export const BOT_AI_LEVEL_9_PROFILE = createBotStrategyProfile(9, {
    controllerId: 'level-9-coordinator'
});

export class BotAI_Level9 extends BotAI {
    constructor(playerId: string) {
        super(playerId, 9, BOT_AI_LEVEL_9_PROFILE);
    }
}
