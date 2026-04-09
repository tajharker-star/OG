import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "@playwright/test";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(clientRoot, "..");
const electronEntry = path.join(clientRoot, "electron", "main.cjs");
const serverEntry = path.resolve(clientRoot, "..", "server", "dist", "index.js");
const captureDate = process.env.NEWS_CAPTURE_DATE || new Date().toISOString().slice(0, 10);
const outputRoot = path.join(repoRoot, "images", "steam-news", captureDate);
const profilesRoot = path.join(clientRoot, "tests", "output", "steam-news-profiles");
const width = 1920;
const height = 1080;

const scenarios = [
  {
    slug: "01-multiplayer-ranked-quick-match",
    title: "Steam multiplayer, ranked quick match, and host flows",
    summary: "Shows the updated multiplayer screen with ranked quick match, LAN hosting, Steam lobbies, and public hosting flow.",
    hoverText: "Steam multiplayer now has a cleaner command hub, ranked quick match, and friend-ready lobby tools.",
    run: async ({ page, capture }) => {
      await openMenuView(page, "Multiplayer");
      await page.waitForSelector(".menu-column--multiplayer", { timeout: 20000 });
      await capture("01-multiplayer-ranked-quick-match.png");
    },
  },
  {
    slug: "02-skins-showroom-and-premium-effects",
    title: "Skins showroom, premium effects, and prestige loadouts",
    summary: "Shows the new skins armory with loadout cards, prestige progression, and the polished showroom presentation.",
    hoverText: "The armory now behaves like a real showroom, with richer effects and clearer prestige progression.",
    run: async ({ page, capture }) => {
      await openMenuView(page, "Skins");
      await page.waitForSelector(".skins-panel", { timeout: 20000 });
      await capture("02-skins-showroom-and-premium-effects.png");
    },
  },
  {
    slug: "03-stats-achievements-and-ranked-rp",
    title: "Stats, achievements, and ranked RP tracking",
    summary: "Shows the long-term stats and achievements screen with ranked progress and career buckets.",
    hoverText: "Progress is easier to read now, with lifetime stats, ranked RP, and achievement tracking all in one place.",
    run: async ({ page, capture }) => {
      await openMenuView(page, "Stats & Achievements");
      await page.waitForSelector(".statistics-screen", { timeout: 20000 });
      await capture("03-stats-achievements-and-ranked-rp.png");
    },
  },
  {
    slug: "04-patch-notes-archive-and-lobby-refresh",
    title: "Patch notes archive and lobby presentation refresh",
    summary: "Shows the icon-first patch notes archive inside the live menu instead of a mockup layout.",
    hoverText: "The menu now carries a quick-scan patch archive so players can see what changed without leaving the game.",
    run: async ({ page, capture }) => {
      await page.locator("button.patch-notes-float-btn").click();
      await page.waitForSelector(".patch-notes-body", { timeout: 20000 });
      await capture("04-patch-notes-archive-and-lobby-refresh.png");
    },
  },
  {
    slug: "05-tutorial-map-playbooks",
    title: "Map-specific tutorial playbooks and onboarding flow",
    summary: "Shows the tutorial map picker that branches the onboarding flow into Desert, Grasslands, and Islands.",
    hoverText: "Tutorial onboarding now changes with the map, teaching different economy and logistics paths instead of one generic lesson.",
    run: async ({ page, capture }) => {
      await waitForCampaignReady(page);
      await openMenuView(page, "Campaign & Custom");
      await page.waitForSelector(".campaign-list", { timeout: 20000 });
      await page.locator(".campaign-card", { hasText: "Tutorial" }).first().click();
      await page.waitForSelector(".tutorial-map-modal", { timeout: 20000 });
      await capture("05-tutorial-map-playbooks.png");
    },
  },
  {
    slug: "06-tutorial-build-hover-and-placement-help",
    title: "Tutorial sandbox, build previews, and placement guidance",
    summary: "Shows the tutorial sandbox with the build menu and hover-preview guidance for map-specific placement decisions.",
    hoverText: "Build cards now explain what to place, where to place it, and why it matters while you learn.",
    run: async ({ page, capture }) => {
      await waitForCampaignReady(page);
      await openMenuView(page, "Campaign & Custom");
      await page.waitForSelector(".campaign-list", { timeout: 20000 });
      await page.locator(".campaign-card", { hasText: "Tutorial" }).first().click();
      await page.waitForSelector(".tutorial-map-modal", { timeout: 20000 });
      await page.locator(".tutorial-map-card", { hasText: "Islands" }).first().click();
      await page.locator(".tutorial-map-modal__actions .menu-btn.primary").click();
      await waitForGameplay(page);
      await page.waitForSelector(".tutorial-panel", { timeout: 30000 });
      await ensureBuildMenuVisible(page);
      await page.locator(".build-category-btn", { hasText: "Economy" }).first().click();
      await page.waitForSelector(".build-group--items", { timeout: 15000 });
      await page.locator(".build-item-btn", { hasText: "Oil Rig" }).first().hover();
      await page.waitForSelector(".action-guide-panel", { timeout: 15000 });
      await capture("06-tutorial-build-hover-and-placement-help.png");
    },
  },
];

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

function cleanupStaleProcesses() {
  spawnSync("pkill", ["-f", serverEntry], { stdio: "ignore" });
  spawnSync("pkill", ["-f", electronEntry], { stdio: "ignore" });
}

async function waitForMainMenu(page) {
  const selector = 'button:has-text("Campaign & Custom")';

  try {
    await page.waitForSelector(selector, { timeout: 6000 });
    return;
  } catch {
    const steamRequired = page.locator('h2:has-text("Steam Required")').first();
    if (await steamRequired.count()) {
      await page.keyboard.press(process.platform === "darwin" ? "Meta+O" : "Control+O");
    }
  }

  await page.waitForSelector(selector, { timeout: 60000 });
}

async function waitForCampaignReady(page) {
  await waitForMainMenu(page);
  await page.waitForSelector('button:has-text("Campaign & Custom"):not([disabled])', { timeout: 60000 });
}

async function waitForGameplay(page) {
  await page.waitForFunction(() => {
    const text = document.body?.innerText ?? "";
    return text.includes("Gold:") && text.includes("Oil:") && !text.includes("STARTING MATCH");
  }, { timeout: 90000 });
}

async function openMenuView(page, label) {
  await waitForMainMenu(page);
  const button = page.locator("button", { hasText: label }).first();
  await button.click();
}

async function hideNoise(page) {
  await page.evaluate(() => {
    const existing = document.getElementById("steam-news-capture-style");
    if (existing) {
      existing.remove();
    }

    const style = document.createElement("style");
    style.id = "steam-news-capture-style";
    style.textContent = `
      .connection-lost-overlay,
      [data-debug-overlay="true"] {
        display: none !important;
        visibility: hidden !important;
      }
    `;
    document.head.appendChild(style);
  });
}

async function captureWindow(electronApp, page, outputPath) {
  await hideNoise(page);

  if (process.platform === "darwin") {
    await electronApp.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (!win) {
        throw new Error("Could not find Electron window for screenshot capture.");
      }
      if (!win.isFullScreen()) {
        win.setFullScreen(true);
      }
    });
    await page.waitForTimeout(1200);
  }

  const pngBase64 = await electronApp.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) {
      throw new Error("Could not find Electron window for screenshot capture.");
    }

    const image = await win.webContents.capturePage();
    return image.toPNG().toString("base64");
  });

  await fs.writeFile(outputPath, Buffer.from(pngBase64, "base64"));
}

async function ensureBuildMenuVisible(page) {
  const buildMenu = page.locator(".build-menu-container");
  if (await buildMenu.count()) {
    return;
  }

  await page.locator(".build-global-toggle-btn").click();
  await page.waitForSelector(".build-menu-container", { timeout: 15000 });
}

async function withScenarioContext(scenario, index) {
  cleanupStaleProcesses();

  const scenarioHome = path.join(profilesRoot, scenario.slug);
  await fs.rm(scenarioHome, { recursive: true, force: true });
  await ensureDir(scenarioHome);

  const launchOptions = {
    args: [electronEntry],
    env: {
      ...process.env,
      DISABLE_STEAM: "1",
      ENABLE_RUNTIME_DEBUG_LOGS: "0",
      HOME: scenarioHome,
      PORT: String(3900 + index),
      ELECTRON_WINDOW_CONTENT_WIDTH: String(width),
      ELECTRON_WINDOW_CONTENT_HEIGHT: String(height),
    },
  };

  const electronApp = await electron.launch(launchOptions);
  let page;

  try {
    page = await electronApp.firstWindow();
    const capture = async (filename) => {
      const outputPath = path.join(outputRoot, filename);
      await captureWindow(electronApp, page, outputPath);
    };

    await scenario.run({ page, capture });
  } finally {
    await electronApp.close().catch(() => {});
    cleanupStaleProcesses();
  }
}

async function writeManifest() {
  const manifest = {
    generatedAt: new Date().toISOString(),
    captureDate,
    outputRoot,
    screenshots: scenarios.map((scenario) => ({
      slug: scenario.slug,
      title: scenario.title,
      summary: scenario.summary,
      hoverText: scenario.hoverText,
      image: path.join(outputRoot, `${scenario.slug}.png`),
    })),
  };

  await fs.writeFile(
    path.join(outputRoot, "steam-news-screenshot-manifest.json"),
    JSON.stringify(manifest, null, 2)
  );
}

async function main() {
  await fs.rm(outputRoot, { recursive: true, force: true });
  await ensureDir(outputRoot);
  await ensureDir(profilesRoot);

  for (const [index, scenario] of scenarios.entries()) {
    process.stdout.write(`Capturing ${scenario.slug}\n`);
    await withScenarioContext(scenario, index);
  }

  await writeManifest();
  process.stdout.write(`Saved screenshots to ${outputRoot}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
