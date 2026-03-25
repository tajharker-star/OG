import { createBotAI } from './BotAIFactory';
import { BotMatchPhase } from './bot-difficulties/BotStrategyProfile';

type Expectation = {
    controllerName: string;
    category: string;
    earlyRecruitment: number;
    lateRecruitment: number;
    lateAirBases: number;
    lateCapitalShipsUnlocked: boolean;
};

const EXPECTATIONS: Record<number, Expectation> = {
    1: { controllerName: 'BotAI_Level1', category: 'easy', earlyRecruitment: 1, lateRecruitment: 1, lateAirBases: 0, lateCapitalShipsUnlocked: true },
    2: { controllerName: 'BotAI_Level2', category: 'easy', earlyRecruitment: 1, lateRecruitment: 1, lateAirBases: 0, lateCapitalShipsUnlocked: true },
    3: { controllerName: 'BotAI_Level3', category: 'easy', earlyRecruitment: 1, lateRecruitment: 1, lateAirBases: 1, lateCapitalShipsUnlocked: true },
    4: { controllerName: 'BotAI_Level4', category: 'medium', earlyRecruitment: 1, lateRecruitment: 2, lateAirBases: 1, lateCapitalShipsUnlocked: true },
    5: { controllerName: 'BotAI_Level5', category: 'medium', earlyRecruitment: 1, lateRecruitment: 2, lateAirBases: 1, lateCapitalShipsUnlocked: true },
    6: { controllerName: 'BotAI_Level6', category: 'medium', earlyRecruitment: 1, lateRecruitment: 2, lateAirBases: 1, lateCapitalShipsUnlocked: true },
    7: { controllerName: 'BotAI_Level7', category: 'hard', earlyRecruitment: 2, lateRecruitment: 3, lateAirBases: 2, lateCapitalShipsUnlocked: true },
    8: { controllerName: 'BotAI_Level8', category: 'hard', earlyRecruitment: 2, lateRecruitment: 3, lateAirBases: 2, lateCapitalShipsUnlocked: true },
    9: { controllerName: 'BotAI_Level9', category: 'hard', earlyRecruitment: 2, lateRecruitment: 3, lateAirBases: 2, lateCapitalShipsUnlocked: true },
    10: { controllerName: 'BotAI_Level10', category: 'insane', earlyRecruitment: 4, lateRecruitment: 5, lateAirBases: 3, lateCapitalShipsUnlocked: true }
};

function setPhase(bot: any, phase: BotMatchPhase) {
    const now = Date.now();
    if (phase === 'EARLY') {
        bot.startTime = now - 60_000;
    } else if (phase === 'MID') {
        bot.startTime = now - 210_000;
    } else {
        bot.startTime = now - 360_000;
    }
    bot.lastMeaningfulActionTime = bot.startTime;
}

function assert(condition: boolean, message: string) {
    if (!condition) {
        throw new Error(message);
    }
}

function main() {
    const failures: string[] = [];

    for (let difficulty = 1; difficulty <= 10; difficulty++) {
        const bot = createBotAI(`bot-${difficulty}`, difficulty) as any;
        const expectation = EXPECTATIONS[difficulty];

        try {
            setPhase(bot, 'EARLY');
            const earlySnapshot = bot.getStrategySnapshot('grasslands', Date.now());

            setPhase(bot, 'LATE');
            const lateSnapshot = bot.getStrategySnapshot('grasslands', Date.now());

            assert(bot.constructor.name === expectation.controllerName, `difficulty ${difficulty} loaded ${bot.constructor.name}`);
            assert(bot.strategyProfile.category === expectation.category, `difficulty ${difficulty} category=${bot.strategyProfile.category}`);
            assert(earlySnapshot.phase === 'EARLY', `difficulty ${difficulty} early phase=${earlySnapshot.phase}`);
            assert(lateSnapshot.phase === 'LATE', `difficulty ${difficulty} late phase=${lateSnapshot.phase}`);
            assert(earlySnapshot.recruitmentBuildings === expectation.earlyRecruitment, `difficulty ${difficulty} early recruitment=${earlySnapshot.recruitmentBuildings}`);
            assert(lateSnapshot.recruitmentBuildings === expectation.lateRecruitment, `difficulty ${difficulty} late recruitment=${lateSnapshot.recruitmentBuildings}`);
            assert(lateSnapshot.airBases === expectation.lateAirBases, `difficulty ${difficulty} late airBases=${lateSnapshot.airBases}`);
            assert(lateSnapshot.capitalShipsUnlocked === expectation.lateCapitalShipsUnlocked, `difficulty ${difficulty} capitalShipsUnlocked=${lateSnapshot.capitalShipsUnlocked}`);
        } catch (error) {
            failures.push((error as Error).message);
        }
    }

    if (failures.length > 0) {
        throw new Error(`Difficulty loading failures:\n${failures.join('\n')}`);
    }

    console.log(JSON.stringify({ status: 'ok', checkedDifficulties: 10 }, null, 2));
}

main();
