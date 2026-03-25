import { createRoot } from 'react-dom/client';
import { LobbyLogo } from './components/LobbyLogo';
import './components/LobbyLogo.css';
import './logo-preview.css';

function LogoPreview() {
    return (
        <div className="logo-preview">
            <div className="logo-preview__stars" aria-hidden="true" />
            <div className="logo-preview__panel">
                <LobbyLogo className="logo-preview__logo" />
                <div className="logo-preview__copy">
                    <span className="logo-preview__eyebrow">Lobby Animation Preview</span>
                    <h1>Lobby Header Treatment</h1>
                    <p>The logo stays untouched. All the motion now comes from the burst, aura, glint, and a masked shine pass that rides over the artwork.</p>
                </div>
                <div className="logo-preview__actions" aria-hidden="true">
                    <button className="logo-preview__button logo-preview__button--primary">Multiplayer</button>
                    <button className="logo-preview__button">Campaign &amp; Custom</button>
                    <button className="logo-preview__button logo-preview__button--ghost">Settings</button>
                </div>
            </div>
        </div>
    );
}

createRoot(document.getElementById('app')!).render(<LogoPreview />);
