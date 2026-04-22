import React from 'react';
import type { SkinId } from '../utils/playerSkins';
import './RankBadgeIcon.css';

export type RankBadgeVariant =
    | 'default'
    | 'gold'
    | 'platinum'
    | 'topaz'
    | 'diamond'
    | 'obsidian'
    | 'godly'
    | 'ruby'
    | 'leaderboard_first'
    | 'leaderboard_second'
    | 'leaderboard_third'
    | 'leaderboard_top10'
    | 'developer';

interface RankBadgeIconProps {
    variant?: RankBadgeVariant;
    skinId?: SkinId;
    leaderboardRank?: number | null;
    size?: 'mini' | 'small' | 'medium' | 'large';
    framed?: boolean;
    className?: string;
    title?: string;
}

const STAR_VARIANTS = new Set<RankBadgeVariant>(['godly', 'ruby', 'leaderboard_first']);
const ORNATE_VARIANTS = new Set<RankBadgeVariant>([
    'diamond',
    'obsidian',
    'godly',
    'ruby',
    'leaderboard_first',
    'leaderboard_second',
    'leaderboard_third',
    'developer',
]);
const SUPER_ORNATE_VARIANTS = new Set<RankBadgeVariant>(['godly', 'ruby', 'leaderboard_first', 'developer']);

export const getBadgeVariantForSkin = (skinId: SkinId): RankBadgeVariant => {
    if (skinId === 'leaderboard_first' || skinId === 'leaderboard_second' || skinId === 'leaderboard_third' || skinId === 'leaderboard_top10') {
        return skinId;
    }

    return skinId;
};

export const getBadgeVariantForLeaderboardRank = (rank?: number | null): RankBadgeVariant => {
    if (rank === 1) return 'leaderboard_first';
    if (rank === 2) return 'leaderboard_second';
    if (rank === 3) return 'leaderboard_third';
    if (rank && rank >= 4 && rank <= 10) return 'leaderboard_top10';
    return 'default';
};

export const getBadgeVariantForRankedPoints = (points: number): RankBadgeVariant => {
    if (points >= 600) return 'godly';
    if (points >= 500) return 'obsidian';
    if (points >= 400) return 'diamond';
    if (points >= 300) return 'topaz';
    if (points >= 200) return 'platinum';
    if (points >= 100) return 'gold';
    return 'default';
};

const renderSparkRing = (variant: RankBadgeVariant) => {
    if (!ORNATE_VARIANTS.has(variant)) {
        return null;
    }

    const sparks = SUPER_ORNATE_VARIANTS.has(variant)
        ? [
            [29, 27, 7], [47, 15, 5], [73, 13, 4], [187, 13, 4], [213, 15, 5], [231, 27, 7],
            [28, 89, 7], [50, 101, 5], [78, 103, 4], [182, 103, 4], [210, 101, 5], [232, 89, 7],
        ]
        : [
            [39, 28, 5], [221, 28, 5], [39, 88, 5], [221, 88, 5],
        ];

    return (
        <g className="rank-badge__spark-ring" aria-hidden="true">
            {sparks.map(([x, y, size], index) => (
                <path
                    key={`${variant}-spark-${index}`}
                    className="rank-badge__spark"
                    d={`M${x} ${y - size} ${x + size * 0.7} ${y} ${x} ${y + size} ${x - size * 0.7} ${y}Z`}
                />
            ))}
        </g>
    );
};

const renderSymbol = (variant: RankBadgeVariant) => {
    switch (variant) {
        case 'gold':
            return (
                <g className="rank-badge__symbol rank-badge__symbol--gold">
                    <circle cx="130" cy="58" r="24" />
                    <circle cx="130" cy="58" r="14" />
                    <path d="M94 58h20M146 58h20M130 22v17M130 77v17M105 33l13 13M155 33l-13 13M105 83l13-13M155 83l-13-13" />
                </g>
            );
        case 'platinum':
            return (
                <g className="rank-badge__symbol rank-badge__symbol--platinum">
                    <path d="M98 35 130 23l32 12-11 46-21 15-21-15Z" />
                    <path d="M98 35h64M111 81l19-58 19 58M109 46l21 50 21-50" />
                    <path d="M82 63c16-9 29-14 48-14s32 5 48 14" />
                </g>
            );
        case 'topaz':
            return (
                <g className="rank-badge__symbol rank-badge__symbol--topaz">
                    <path d="M130 20c22 18 28 35 12 54l-12 22-12-22c-16-19-10-36 12-54Z" />
                    <path d="M130 28 112 64h36ZM112 64l18 32 18-32" />
                    <path d="M92 72c12-13 23-19 38-19s26 6 38 19" />
                </g>
            );
        case 'diamond':
            return (
                <g className="rank-badge__symbol rank-badge__symbol--diamond">
                    <path d="M130 17 174 58l-44 41-44-41Z" />
                    <path d="M130 17 111 58l19 41 19-41ZM86 58h88M103 34l27 24 27-24M103 82l27-24 27 24" />
                    <path d="M76 58 96 46M184 58l-20-12M76 58l20 12M184 58l-20 12" />
                </g>
            );
        case 'obsidian':
            return (
                <g className="rank-badge__symbol rank-badge__symbol--obsidian">
                    <path d="M86 39 130 22l44 17-9 37-35 23-35-23Z" />
                    <path d="M101 50 130 33l29 17M103 67l27 20 27-20M130 33v54" />
                    <path d="M121 42 110 59l15 2-9 24M142 40l-12 20 18-2-13 27" />
                </g>
            );
        case 'godly':
            return (
                <g className="rank-badge__symbol rank-badge__symbol--godly">
                    <ellipse cx="130" cy="58" rx="45" ry="24" />
                    <ellipse cx="130" cy="58" rx="30" ry="14" />
                    <path className="rank-badge__symbol-star" d="m130 25 8 22 24 2-18 15 6 23-20-13-20 13 6-23-18-15 24-2Z" />
                    <path d="M77 58H54M206 58h-23M130 9v17M130 90v17" />
                </g>
            );
        case 'ruby':
            return (
                <g className="rank-badge__symbol rank-badge__symbol--ruby">
                    <path d="M130 18 160 44 150 84 130 100 110 84 100 44Z" />
                    <path d="M130 18v82M100 44h60M110 84l20-40 20 40" />
                    <path className="rank-badge__symbol-star" d="m90 31 4 10 11 1-8 7 2 11-9-6-9 6 2-11-8-7 11-1Z" />
                    <path className="rank-badge__symbol-star" d="m170 73 4 10 11 1-8 7 2 11-9-6-9 6 2-11-8-7 11-1Z" />
                </g>
            );
        case 'leaderboard_first':
            return (
                <g className="rank-badge__symbol rank-badge__symbol--leaderboard-first">
                    <path d="M90 45 108 27l22 22 22-22 18 18-8 34H98Z" />
                    <path className="rank-badge__symbol-star" d="m130 39 7 16 18 2-14 12 4 18-15-10-15 10 4-18-14-12 18-2Z" />
                    <path d="M80 84c20 13 33 18 50 18s30-5 50-18" />
                </g>
            );
        case 'leaderboard_second':
            return (
                <g className="rank-badge__symbol rank-badge__symbol--leaderboard-second">
                    <path d="M86 75c11-29 29-42 44-48 15 6 33 19 44 48-15-10-28-14-44-14s-29 4-44 14Z" />
                    <path d="M105 84c13 9 37 9 50 0M101 54c20-10 38-10 58 0" />
                    <path d="M130 31 144 58 130 84 116 58Z" />
                </g>
            );
        case 'leaderboard_third':
            return (
                <g className="rank-badge__symbol rank-badge__symbol--leaderboard-third">
                    <path d="M94 46 130 25l36 21-7 39-29 16-29-16Z" />
                    <path d="M102 54h56M111 73h38M130 25v76" />
                    <path d="M90 58 71 48l8 28M170 58l19-10-8 28" />
                </g>
            );
        case 'leaderboard_top10':
            return (
                <g className="rank-badge__symbol rank-badge__symbol--leaderboard-top10">
                    <path d="M92 42 130 23l38 19v34l-38 20-38-20Z" />
                    <path d="m111 50 19-10 19 10M105 65l25-13 25 13M111 80l19-10 19 10" />
                    <path d="M75 69c10-17 23-29 39-36M185 69c-10-17-23-29-39-36" />
                </g>
            );
        case 'developer':
            return (
                <g className="rank-badge__symbol rank-badge__symbol--developer">
                    <path d="M130 16 166 48 151 92 130 104 109 92 94 48Z" />
                    <path d="M130 28v64M104 52h52M113 38l34 48M147 38l-34 48" />
                    <path d="M86 58c17-23 31-32 44-32s27 9 44 32c-17 23-31 32-44 32s-27-9-44-32Z" />
                </g>
            );
        case 'default':
        default:
            return (
                <g className="rank-badge__symbol rank-badge__symbol--default">
                    <path d="M94 43h72l-14 15 14 15H94l14-15Z" />
                    <circle cx="130" cy="58" r="13" />
                    <path d="M112 58h36M130 40v36" />
                </g>
            );
    }
};

export const RankBadgeIcon: React.FC<RankBadgeIconProps> = ({
    variant,
    skinId,
    leaderboardRank,
    size = 'medium',
    framed = true,
    className = '',
    title = 'Rank badge',
}) => {
    const resolvedVariant = variant
        || (skinId ? getBadgeVariantForSkin(skinId) : null)
        || getBadgeVariantForLeaderboardRank(leaderboardRank);
    const svgId = React.useId().replace(/[^a-zA-Z0-9_-]/g, '');
    const faceGradientId = `rankBadgeFace-${svgId}-${resolvedVariant}`;
    const insetGradientId = `rankBadgeInset-${svgId}-${resolvedVariant}`;
    const glowGradientId = `rankBadgeGlow-${svgId}-${resolvedVariant}`;
    const texturePatternId = `rankBadgeTexture-${svgId}-${resolvedVariant}`;
    const hasStar = STAR_VARIANTS.has(resolvedVariant);

    return (
        <span className={`rank-badge rank-badge--${resolvedVariant} rank-badge--${size} ${framed ? 'rank-badge--framed' : ''} ${className}`.trim()}>
            <svg className="rank-badge__svg" viewBox="0 0 260 116" role="img" aria-label={title}>
                <defs>
                    <linearGradient id={faceGradientId} x1="26" y1="12" x2="234" y2="104" gradientUnits="userSpaceOnUse">
                        <stop offset="0" stopColor="var(--rank-badge-highlight)" />
                        <stop offset="0.34" stopColor="var(--rank-badge-primary)" />
                        <stop offset="0.72" stopColor="var(--rank-badge-secondary)" />
                        <stop offset="1" stopColor="var(--rank-badge-shadow)" />
                    </linearGradient>
                    <linearGradient id={insetGradientId} x1="56" y1="26" x2="204" y2="90" gradientUnits="userSpaceOnUse">
                        <stop offset="0" stopColor="rgba(255,255,255,.84)" />
                        <stop offset="0.45" stopColor="var(--rank-badge-secondary)" />
                        <stop offset="1" stopColor="var(--rank-badge-primary)" />
                    </linearGradient>
                    <radialGradient id={glowGradientId} cx="50%" cy="48%" r="64%">
                        <stop offset="0" stopColor="var(--rank-badge-glow)" stopOpacity="0.96" />
                        <stop offset="0.52" stopColor="var(--rank-badge-glow)" stopOpacity="0.34" />
                        <stop offset="1" stopColor="var(--rank-badge-glow)" stopOpacity="0" />
                    </radialGradient>
                    <pattern id={texturePatternId} width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(22)">
                        <path d="M0 0h2v12H0zM7 0h1v12H7z" fill="rgba(255,255,255,.22)" />
                        <path d="M4 0h1v12H4z" fill="rgba(0,0,0,.16)" />
                    </pattern>
                </defs>

                <ellipse className="rank-badge__radiance" cx="130" cy="58" rx="120" ry="50" fill={`url(#${glowGradientId})`} />
                <path className="rank-badge__flame rank-badge__flame--left" d="M36 57 5 36l25 2-14-18 48 16 11 21-11 21-48 16 14-18-25 2Z" />
                <path className="rank-badge__flame rank-badge__flame--right" d="M224 57 255 36l-25 2 14-18-48 16-11 21 11 21 48 16-14-18 25 2Z" />
                <path className="rank-badge__shadow" d="M30 61 55 23h150l25 38-25 38H55Z" />
                <path className="rank-badge__body" d="M28 56 54 18h152l26 38-26 38H54Z" fill={`url(#${faceGradientId})`} />
                <path className="rank-badge__body-texture" d="M42 56 62 28h136l20 28-20 28H62Z" fill={`url(#${texturePatternId})`} />
                <path className="rank-badge__rim" d="M47 56 65 31h130l18 25-18 25H65Z" />
                <path className="rank-badge__plate" d="M67 56 82 37h96l15 19-15 19H82Z" fill={`url(#${insetGradientId})`} />

                <path className="rank-badge__side-gem rank-badge__side-gem--left-a" d="M48 56 37 44l11-12 11 12Z" />
                <path className="rank-badge__side-gem rank-badge__side-gem--left-b" d="M63 90 53 80l10-10 10 10Z" />
                <path className="rank-badge__side-gem rank-badge__side-gem--right-a" d="M212 56 201 44l11-12 11 12Z" />
                <path className="rank-badge__side-gem rank-badge__side-gem--right-b" d="M197 90 187 80l10-10 10 10Z" />

                {renderSparkRing(resolvedVariant)}
                {renderSymbol(resolvedVariant)}

                {hasStar && (
                    <path className="rank-badge__rare-star" d="m130 9 5 12 13 1-10 8 3 13-11-7-11 7 3-13-10-8 13-1Z" />
                )}

                <path className="rank-badge__ember" d="M51 83c31 9 56 14 79 14s48-5 79-14c-22 20-47 29-79 29s-57-9-79-29Z" />
                <path className="rank-badge__shine" d="M62 28c34-13 77-15 121-3L75 79c-16-16-20-34-13-51Z" />
            </svg>
        </span>
    );
};
