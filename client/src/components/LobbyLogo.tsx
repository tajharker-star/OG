import './LobbyLogo.css';
import lobbyBurstUrl from '../assets/lobby/conquerors-domination-burst.png';
import lobbyLogoUrl from '../assets/lobby/conquerors-domination-logo.png';

type LobbyLogoProps = {
    className?: string;
};

export function LobbyLogo({ className = '' }: LobbyLogoProps) {
    const classes = ['lobby-logo', className].filter(Boolean).join(' ');

    return (
        <div
            className={classes}
            role="img"
            aria-label="Conquerors: Domination"
            style={{
                ['--lobby-logo-image' as string]: `url(${lobbyLogoUrl})`,
                ['--lobby-logo-burst' as string]: `url(${lobbyBurstUrl})`,
            }}
        >
            <div className="lobby-logo__burst" aria-hidden="true" />
            <div className="lobby-logo__ray-fan" aria-hidden="true" />
            <div className="lobby-logo__halo" aria-hidden="true" />
            <div className="lobby-logo__artwork" aria-hidden="true">
                <div className="lobby-logo__media">
                    <div className="lobby-logo__edge-glow" />
                    <div className="lobby-logo__star-glint" />
                    <img className="lobby-logo__image" src={lobbyLogoUrl} alt="" />
                    <div className="lobby-logo__shine" />
                    <span className="lobby-logo__spark lobby-logo__spark--left" />
                    <span className="lobby-logo__spark lobby-logo__spark--center" />
                    <span className="lobby-logo__spark lobby-logo__spark--right" />
                </div>
            </div>
        </div>
    );
}
