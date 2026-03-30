const iconModules = import.meta.glob('../assets/achievements/*.png', {
    eager: true,
    import: 'default',
}) as Record<string, string>;

const iconsByName = Object.fromEntries(
    Object.entries(iconModules).map(([modulePath, assetUrl]) => {
        const fileName = modulePath.split('/').pop() ?? modulePath;
        return [fileName.replace(/\.png$/u, ''), assetUrl];
    })
);

const fallbackIcon = iconsByName.FIRST_DEPLOYMENT ?? '';

export const getAchievementIcon = (achievementId: string, unlocked: boolean) => {
    const requestedIcon = iconsByName[`${achievementId}${unlocked ? '' : '_locked'}`];
    return requestedIcon ?? fallbackIcon;
};
