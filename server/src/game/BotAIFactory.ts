import { BotAI } from './BotAI';
import { BotAI_Level1 } from './bot-difficulties/BotAI_Level1';
import { BotAI_Level2 } from './bot-difficulties/BotAI_Level2';
import { BotAI_Level3 } from './bot-difficulties/BotAI_Level3';
import { BotAI_Level4 } from './bot-difficulties/BotAI_Level4';
import { BotAI_Level5 } from './bot-difficulties/BotAI_Level5';
import { BotAI_Level6 } from './bot-difficulties/BotAI_Level6';
import { BotAI_Level7 } from './bot-difficulties/BotAI_Level7';
import { BotAI_Level8 } from './bot-difficulties/BotAI_Level8';
import { BotAI_Level9 } from './bot-difficulties/BotAI_Level9';
import { BotAI_Level10 } from './bot-difficulties/BotAI_Level10';

export function createBotAI(playerId: string, difficulty: number = 5): BotAI {
    const level = Math.max(1, Math.min(10, difficulty));

    switch (level) {
        case 1:
            return new BotAI_Level1(playerId);
        case 2:
            return new BotAI_Level2(playerId);
        case 3:
            return new BotAI_Level3(playerId);
        case 4:
            return new BotAI_Level4(playerId);
        case 5:
            return new BotAI_Level5(playerId);
        case 6:
            return new BotAI_Level6(playerId);
        case 7:
            return new BotAI_Level7(playerId);
        case 8:
            return new BotAI_Level8(playerId);
        case 9:
            return new BotAI_Level9(playerId);
        default:
            return new BotAI_Level10(playerId);
    }
}
