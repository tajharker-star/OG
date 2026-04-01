import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientRoot = path.resolve(__dirname, '..');
const sourceDir = path.join(clientRoot, 'src', 'assets', 'achievements');
const steamDir = path.join(clientRoot, 'steam-achievements', 'demo');
const steamUnlockedDir = path.join(steamDir, 'unlocked');
const steamLockedDir = path.join(steamDir, 'locked');
const sourceSvgDir = path.join(steamDir, 'source-svg');
const size = 256;

const CATEGORY_THEME = {
    General: {
        label: 'GENERAL',
        colors: ['#ffb14d', '#ffe08a'],
        glow: 'rgba(255, 182, 77, 0.38)',
        panel: '#1c1410',
        ring: '#ffd98a',
    },
    Campaign: {
        label: 'CAMPAIGN',
        colors: ['#68d4a6', '#c3f2d9'],
        glow: 'rgba(104, 212, 166, 0.34)',
        panel: '#10201a',
        ring: '#a3e7c9',
    },
    Custom: {
        label: 'CUSTOM',
        colors: ['#5faeff', '#d3e5ff'],
        glow: 'rgba(95, 174, 255, 0.34)',
        panel: '#111c2d',
        ring: '#a7ccff',
    },
    Multiplayer: {
        label: 'MULTI',
        colors: ['#ff7864', '#ffbf74'],
        glow: 'rgba(255, 120, 100, 0.34)',
        panel: '#281512',
        ring: '#ffb08c',
    },
    'Co-op': {
        label: 'CO-OP',
        colors: ['#4dd8d0', '#b8fbf4'],
        glow: 'rgba(77, 216, 208, 0.34)',
        panel: '#102221',
        ring: '#9bece6',
    },
    Ranked: {
        label: 'RANKED',
        colors: ['#ff6b56', '#ffd056'],
        glow: 'rgba(255, 107, 86, 0.34)',
        panel: '#261712',
        ring: '#ffb778',
    },
};

const LOCKED_THEME = {
    colors: ['#7c8799', '#d0d7e4'],
    glow: 'rgba(167, 176, 191, 0.2)',
    panel: '#151820',
    ring: '#a6b1c2',
};

const ACHIEVEMENTS = [
    { id: 'FIRST_DEPLOYMENT', title: 'First Deployment', description: 'Play your first match.', monogram: 'FD', category: 'General', tier: 1 },
    { id: 'FIELD_TESTED', title: 'Field Tested', description: 'Play 10 matches.', monogram: 'FT', category: 'General', tier: 2 },
    { id: 'WAR_MACHINE', title: 'War Machine', description: 'Play 50 matches.', monogram: 'WM', category: 'General', tier: 3 },
    { id: 'FIRST_VICTORY', title: 'First Victory', description: 'Win your first match.', monogram: 'FV', category: 'General', tier: 1 },
    { id: 'SEASONED_WINNER', title: 'Seasoned Winner', description: 'Win 10 matches.', monogram: 'SW', category: 'General', tier: 2 },
    { id: 'DOMINATOR', title: 'Dominator', description: 'Win 50 matches.', monogram: 'DM', category: 'General', tier: 3 },
    { id: 'STAYING_POWER', title: 'Staying Power', description: 'Reach a 3-match win streak.', monogram: 'SP', category: 'General', tier: 2 },
    { id: 'LEGENDARY_STREAK', title: 'Legendary Streak', description: 'Reach a 7-match win streak.', monogram: 'LS', category: 'General', tier: 3 },
    { id: 'CAMPAIGN_INITIATE', title: 'Campaign Initiate', description: 'Complete your first campaign battle.', monogram: 'CI', category: 'Campaign', tier: 1 },
    { id: 'TUTORIAL_GRADUATE', title: 'Tutorial Graduate', description: 'Beat the tutorial by completing every tutorial objective or by adding a bot and defeating it.', monogram: 'TG', category: 'Campaign', tier: 1 },
    { id: 'CAMPAIGN_CONQUEROR', title: 'Campaign Conqueror', description: 'Win 5 campaign battles.', monogram: 'CC', category: 'Campaign', tier: 2 },
    { id: 'CAMPAIGN_LEGEND', title: 'Campaign Legend', description: 'Win 15 campaign battles.', monogram: 'CL', category: 'Campaign', tier: 3 },
    { id: 'SKIRMISH_STARTER', title: 'Skirmish Starter', description: 'Play your first custom match.', monogram: 'SS', category: 'Custom', tier: 1 },
    { id: 'SKIRMISH_SUPREME', title: 'Skirmish Supreme', description: 'Win 10 custom matches.', monogram: 'SU', category: 'Custom', tier: 3 },
    { id: 'NETWORK_INITIATE', title: 'Network Initiate', description: 'Play your first multiplayer match.', monogram: 'NI', category: 'Multiplayer', tier: 1 },
    { id: 'ONLINE_WARLORD', title: 'Online Warlord', description: 'Win 10 multiplayer matches.', monogram: 'OW', category: 'Multiplayer', tier: 2 },
    { id: 'ONLINE_LEGEND', title: 'Online Legend', description: 'Win 25 multiplayer matches.', monogram: 'OL', category: 'Multiplayer', tier: 3 },
    { id: 'COOP_WINGMAN', title: 'Co-op Wingman', description: 'Win your first co-op or PvE match.', monogram: 'CW', category: 'Co-op', tier: 1 },
    { id: 'BOT_LEVEL_7', title: 'Bot Hunter 7', description: 'Defeat a level 7 bot.', monogram: 'B7', category: 'Co-op', tier: 1 },
    { id: 'BOT_LEVEL_8', title: 'Bot Hunter 8', description: 'Defeat a level 8 bot.', monogram: 'B8', category: 'Co-op', tier: 1 },
    { id: 'BOT_LEVEL_9', title: 'Bot Hunter 9', description: 'Defeat a level 9 bot.', monogram: 'B9', category: 'Co-op', tier: 2 },
    { id: 'BOT_LEVEL_10', title: 'Bot Hunter 10', description: 'Defeat a level 10 bot.', monogram: 'B10', category: 'Co-op', tier: 3 },
    { id: 'PVE_COMMANDER', title: 'PvE Commander', description: 'Win 10 co-op or PvE matches.', monogram: 'PV', category: 'Co-op', tier: 2 },
    { id: 'RANKED_ROOKIE', title: 'Ranked Rookie', description: 'Play your first ranked match.', monogram: 'RR', category: 'Ranked', tier: 1 },
    { id: 'RANKED_CONTENDER', title: 'Ranked Contender', description: 'Win 5 ranked matches.', monogram: 'RC', category: 'Ranked', tier: 2 },
];

const ensureDir = async directory => fs.mkdir(directory, { recursive: true });

const pointsForStar = (x, y, outerRadius, innerRadius) => {
    const points = [];
    for (let i = 0; i < 10; i += 1) {
        const angle = (-Math.PI / 2) + (i * Math.PI / 5);
        const radius = i % 2 === 0 ? outerRadius : innerRadius;
        points.push(`${x + Math.cos(angle) * radius},${y + Math.sin(angle) * radius}`);
    }
    return points.join(' ');
};

const renderTierStars = (tier, fill) => {
    const offsets = tier === 1 ? [0] : tier === 2 ? [-14, 14] : [-28, 0, 28];
    return offsets.map(offset => (
        `<polygon points="${pointsForStar(128 + offset, 204, 8, 4)}" fill="${fill}" opacity="0.96" />`
    )).join('');
};

const renderCategoryGlyph = (category, fill) => {
    switch (category) {
        case 'General':
            return `
                <circle cx="128" cy="92" r="21" fill="none" stroke="${fill}" stroke-width="4.5" />
                <circle cx="128" cy="92" r="8" fill="${fill}" opacity="0.95" />
                <path d="M128 58v16 M128 110v16 M94 92h16 M146 92h16" stroke="${fill}" stroke-width="4.5" stroke-linecap="round" />
            `;
        case 'Campaign':
            return `
                <path d="M108 118V62" stroke="${fill}" stroke-width="5" stroke-linecap="round" />
                <path d="M112 66C132 58 144 60 156 68V99C143 90 130 89 112 95Z" fill="${fill}" opacity="0.95" />
            `;
        case 'Custom':
            return `
                <polygon points="128,64 154,79 154,109 128,124 102,109 102,79" fill="none" stroke="${fill}" stroke-width="4.5" />
                <path d="M128 64v60 M102 79l52 30 M154 79l-52 30" stroke="${fill}" stroke-width="3" stroke-linecap="round" opacity="0.82" />
            `;
        case 'Multiplayer':
            return `
                <path d="M110 76L128 102L146 76 M110 76L98 106 M146 76L158 106 M98 106H158" stroke="${fill}" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round" />
                <circle cx="110" cy="76" r="8" fill="${fill}" />
                <circle cx="128" cy="102" r="8" fill="${fill}" />
                <circle cx="146" cy="76" r="8" fill="${fill}" />
                <circle cx="98" cy="106" r="7" fill="${fill}" opacity="0.88" />
                <circle cx="158" cy="106" r="7" fill="${fill}" opacity="0.88" />
            `;
        case 'Co-op':
            return `
                <circle cx="117" cy="92" r="18" fill="none" stroke="${fill}" stroke-width="4.5" />
                <circle cx="139" cy="92" r="18" fill="none" stroke="${fill}" stroke-width="4.5" />
                <path d="M111 112h34" stroke="${fill}" stroke-width="5" stroke-linecap="round" opacity="0.92" />
            `;
        case 'Ranked':
            return `
                <path d="M102 108V74L116 86L128 72L140 86L154 74V108Z" fill="${fill}" opacity="0.96" />
                <circle cx="116" cy="86" r="3.5" fill="#08111b" />
                <circle cx="128" cy="72" r="3.5" fill="#08111b" />
                <circle cx="140" cy="86" r="3.5" fill="#08111b" />
            `;
        default:
            return '';
    }
};

const escapeHtml = value => value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

const buildSvg = ({ id, monogram, category, tier }, locked) => {
    const categoryTheme = CATEGORY_THEME[category];
    const theme = locked
        ? { ...categoryTheme, ...LOCKED_THEME, label: categoryTheme.label }
        : categoryTheme;
    const bannerText = locked ? 'LOCKED' : categoryTheme.label;
    const [accentA, accentB] = theme.colors;
    const glyphFill = locked ? '#d5dde9' : accentB;
    const starsFill = locked ? '#b5c0cf' : accentB;

    return `
        <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
            <defs>
                <radialGradient id="bg" cx="50%" cy="38%" r="70%">
                    <stop offset="0%" stop-color="#152235" />
                    <stop offset="62%" stop-color="#0e1624" />
                    <stop offset="100%" stop-color="#09111d" />
                </radialGradient>
                <linearGradient id="ring" x1="24" y1="24" x2="228" y2="232">
                    <stop offset="0%" stop-color="${accentB}" />
                    <stop offset="100%" stop-color="${accentA}" />
                </linearGradient>
                <linearGradient id="plate" x1="76" y1="54" x2="176" y2="202">
                    <stop offset="0%" stop-color="${theme.panel}" />
                    <stop offset="100%" stop-color="#0a0f19" />
                </linearGradient>
                <filter id="softGlow" x="-40%" y="-40%" width="180%" height="180%">
                    <feDropShadow dx="0" dy="0" stdDeviation="10" flood-color="${theme.glow}" />
                </filter>
            </defs>
            <rect x="0" y="0" width="${size}" height="${size}" rx="52" fill="#060b13" />
            <circle cx="128" cy="128" r="98" fill="url(#bg)" />
            <circle cx="128" cy="128" r="96" fill="none" stroke="url(#ring)" stroke-width="12" filter="url(#softGlow)" />
            <circle cx="128" cy="128" r="79" fill="url(#plate)" stroke="${theme.ring}" stroke-width="2" opacity="0.96" />
            <path d="M58 72C84 48 115 38 154 42C176 44 196 52 214 68" fill="none" stroke="${accentB}" stroke-width="6" stroke-linecap="round" opacity="0.22" />
            <path d="M52 194C76 212 102 220 128 220C155 220 182 211 204 194" fill="none" stroke="${accentA}" stroke-width="5" stroke-linecap="round" opacity="0.18" />
            <rect x="58" y="28" width="140" height="28" rx="14" fill="${locked ? 'rgba(153, 165, 183, 0.18)' : 'rgba(8, 14, 24, 0.44)'}" stroke="${locked ? 'rgba(179, 191, 208, 0.25)' : 'rgba(255,255,255,0.12)'}" />
            <text x="128" y="47" text-anchor="middle" fill="${locked ? '#dce4ef' : accentB}" font-family="'Avenir Next', 'Trebuchet MS', sans-serif" font-size="13" font-weight="700" letter-spacing="1.8">${escapeHtml(bannerText)}</text>
            ${renderCategoryGlyph(category, glyphFill)}
            <text x="128" y="164" text-anchor="middle" fill="${locked ? '#edf2f8' : '#fff7e5'}" font-family="'Avenir Next Condensed', 'Avenir Next', 'Trebuchet MS', sans-serif" font-size="52" font-weight="800" letter-spacing="2">${escapeHtml(monogram)}</text>
            ${renderTierStars(tier, starsFill)}
            <text x="128" y="232" text-anchor="middle" fill="${locked ? '#98a5b8' : accentA}" font-family="'Avenir Next', 'Trebuchet MS', sans-serif" font-size="10" font-weight="700" letter-spacing="3">${escapeHtml(id.replaceAll('_', ' '))}</text>
        </svg>
    `;
};

const renderPng = async (page, svg, outputPath) => {
    const html = `
        <!doctype html>
        <html>
            <body style="margin:0;width:${size}px;height:${size}px;background:transparent;overflow:hidden;">
                ${svg}
            </body>
        </html>
    `;
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(html, { waitUntil: 'load' });
    await page.screenshot({ path: outputPath, omitBackground: true });
};

const csvEscape = value => `"${String(value).replaceAll('"', '""')}"`;

const writeSteamMetadata = async () => {
    const manifestPath = path.join(steamDir, 'steamworks-achievements.json');
    const csvPath = path.join(steamDir, 'steamworks-achievements.csv');
    const manifest = {
        appId: '4432220',
        appName: 'Conquerors: Domination Demo',
        generatedAt: new Date().toISOString(),
        achievements: ACHIEVEMENTS.map((achievement) => ({
            apiName: achievement.id,
            title: achievement.title,
            description: achievement.description,
            category: achievement.category,
            unlockedIcon: `unlocked/${achievement.id}.png`,
            lockedIcon: `locked/${achievement.id}.png`,
        })),
    };

    const csvLines = [
        ['api_name', 'title', 'description', 'category', 'unlocked_icon', 'locked_icon'].map(csvEscape).join(','),
        ...ACHIEVEMENTS.map((achievement) => (
            [
                achievement.id,
                achievement.title,
                achievement.description,
                achievement.category,
                `unlocked/${achievement.id}.png`,
                `locked/${achievement.id}.png`,
            ].map(csvEscape).join(',')
        )),
    ];

    await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    await fs.writeFile(csvPath, `${csvLines.join('\n')}\n`, 'utf8');
};

const writeReadme = async () => {
    const readmePath = path.join(steamDir, 'README.md');
    const lines = [
        '# Steam Achievement Icons',
        '',
        'This folder is generated by `npm run build:achievement-icons`.',
        '',
        '- `unlocked/` contains the colored Steam-ready PNGs.',
        '- `locked/` contains the grayscale variants.',
        '- `source-svg/` contains editable SVG source exports for the same set.',
        '- `steamworks-achievements.json` contains the exact API names, titles, descriptions, and icon paths to copy into Steamworks.',
        '- `steamworks-achievements.csv` contains the same achievement metadata in a quick spreadsheet-friendly format.',
        '',
        'Current target app: `4432220` (Conquerors: Domination Demo).',
    ];
    await fs.writeFile(readmePath, `${lines.join('\n')}\n`, 'utf8');
};

const main = async () => {
    await Promise.all([
        ensureDir(sourceDir),
        ensureDir(steamUnlockedDir),
        ensureDir(steamLockedDir),
        ensureDir(sourceSvgDir),
    ]);

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ deviceScaleFactor: 1 });

    for (const achievement of ACHIEVEMENTS) {
        for (const locked of [false, true]) {
            const suffix = locked ? '_locked' : '';
            const svg = buildSvg(achievement, locked);
            const fileName = `${achievement.id}${suffix}`;
            await fs.writeFile(path.join(sourceSvgDir, `${fileName}.svg`), svg, 'utf8');
            await renderPng(page, svg, path.join(sourceDir, `${fileName}.png`));
            await renderPng(page, svg, path.join(locked ? steamLockedDir : steamUnlockedDir, `${achievement.id}.png`));
        }
    }

    await browser.close();
    await writeSteamMetadata();
    await writeReadme();
    process.stdout.write(`Generated ${ACHIEVEMENTS.length * 2} achievement icons.\n`);
};

main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
});
