import { _electron as electron } from '@playwright/test';
import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('launch app', async () => {
    const electronApp = await electron.launch({
        args: [path.join(__dirname, '../electron/main.cjs')],
    });

    const isPackaged = await electronApp.evaluate(async ({ app }) => {
        return app.isPackaged;
    });

    console.log(`Is Packaged: ${isPackaged}`);

    const window = await electronApp.firstWindow();

    // Wait for the window to be visible
    await expect(window).toBeVisible({ timeout: 15000 });

    // Take a screenshot for visual verification in CI
    await window.screenshot({ path: 'tests/output/launch-screenshot.png' });

    // Check for console errors
    window.on('console', msg => {
        if (msg.type() === 'error') {
            console.error(`Window Error: ${msg.text()}`);
        }
    });

    await electronApp.close();
});
