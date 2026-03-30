import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { LoginSession, EAuthTokenPlatformType } from 'steam-session';

const defaultAppId = process.argv[2] ?? '4432220';
const username = process.env.STEAM_USERNAME;
const password = process.env.STEAM_PASSWORD;

if (!username || !password) {
    throw new Error('Missing STEAM_USERNAME or STEAM_PASSWORD.');
}

const parseCookie = cookieString => {
    const segments = cookieString.split(';').map(segment => segment.trim());
    const [nameValue, ...attributePairs] = segments;
    const separatorIndex = nameValue.indexOf('=');
    const cookie = {
        name: nameValue.slice(0, separatorIndex),
        value: nameValue.slice(separatorIndex + 1),
        path: '/',
        secure: false,
        httpOnly: false,
    };

    attributePairs.forEach(attribute => {
        const [rawKey, ...rawValue] = attribute.split('=');
        const key = rawKey.toLowerCase();
        const value = rawValue.join('=');
        if (key === 'domain') cookie.domain = value;
        if (key === 'path') cookie.path = value;
        if (key === 'secure') cookie.secure = true;
        if (key === 'httponly') cookie.httpOnly = true;
        if (key === 'samesite') cookie.sameSite = value;
        if (key === 'expires') cookie.expires = Math.floor(new Date(value).getTime() / 1000);
    });

    if (cookie.domain == null) {
        throw new Error(`Missing domain for cookie ${cookie.name}.`);
    }

    return {
        ...cookie,
        sameSite: cookie.sameSite === 'None' ? 'None' : cookie.sameSite === 'Strict' ? 'Strict' : 'Lax',
    };
};

const waitForAuthentication = async loginSession => {
    const webCookies = await new Promise((resolve, reject) => {
        loginSession.loginTimeout = 180000;
        loginSession.on('polling', () => console.log('[partner-probe] Waiting for Steam Guard approval...'));
        loginSession.on('remoteInteraction', () => console.log('[partner-probe] Steam Guard prompt opened on mobile.'));
        loginSession.on('timeout', () => reject(new Error('Steam Guard approval timed out.')));
        loginSession.on('error', reject);
        loginSession.on('authenticated', async () => {
            try {
                resolve(await loginSession.getWebCookies());
            } catch (error) {
                reject(error);
            }
        });
    });

    return webCookies.map(parseCookie);
};

const tryPartnerSignIn = async (page, targetUrl) => {
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    if (await page.locator('#login_btn_signin').count()) {
        const popupPromise = page.waitForEvent('popup', { timeout: 4000 }).catch(() => null);
        await page.locator('#login_btn_signin').click();
        const popup = await popupPromise;
        if (popup) {
            await popup.waitForLoadState('domcontentloaded').catch(() => null);
            await popup.waitForTimeout(3000);
            await popup.close().catch(() => null);
        }
        await page.waitForTimeout(4000);
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    }
};

const main = async () => {
    const targetUrl = `https://partner.steamgames.com/apps/achievements/${defaultAppId}`;
    const loginSession = new LoginSession(EAuthTokenPlatformType.WebBrowser);
    const result = await loginSession.startWithCredentials({
        accountName: username,
        password,
    });
    console.log('[partner-probe] Login start result:', JSON.stringify(result));

    const cookies = await waitForAuthentication(loginSession);
    const cookieOutput = path.join(os.tmpdir(), 'steam-partner-probe-cookies.json');
    await fs.writeFile(cookieOutput, JSON.stringify(cookies, null, 2));

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    await context.addCookies(cookies);
    const page = await context.newPage();

    await tryPartnerSignIn(page, targetUrl);

    const authSucceeded = !(await page.locator('#login_btn_signin').count()) && !page.url().includes('?goto=');
    const screenshotPath = path.join(os.tmpdir(), 'steam-partner-probe.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });

    console.log('[partner-probe] Final URL:', page.url());
    console.log('[partner-probe] Auth succeeded:', authSucceeded);
    console.log('[partner-probe] Screenshot:', screenshotPath);
    console.log('[partner-probe] Cookie dump:', cookieOutput);
    console.log('[partner-probe] Page title:', await page.title());
    console.log('[partner-probe] Page text preview:', (await page.textContent('body'))?.slice(0, 1800) ?? '');

    await browser.close();

    if (!authSucceeded) {
        throw new Error('Steam web auth succeeded, but partner session was not established.');
    }
};

main().catch(error => {
    process.stderr.write(`[partner-probe] ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
});
