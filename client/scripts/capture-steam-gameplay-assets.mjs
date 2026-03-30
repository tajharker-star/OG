import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "@playwright/test";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientRoot = path.resolve(__dirname, "..");
const outputRoot = path.join(clientRoot, "steam-store-assets", "main");
const screenshotsDir = path.join(outputRoot, "screenshots");
const trailerDir = path.join(outputRoot, "trailer");
const videoTempDir = path.join(clientRoot, "tests", "output", "store-trailer-video");
const electronEntry = path.join(clientRoot, "electron", "main.cjs");
const serverEntry = path.resolve(clientRoot, "..", "server", "dist", "index.js");
const screenshotWidth = 1920;
const screenshotHeight = 1080;

const scenarios = [
  {
    name: "islands-midgame",
    mapType: "islands",
    botCount: 6,
    difficulty: 7,
    settleMs: 30000,
    screenshot: "screenshot-01-1920x1080.png",
    recordVideo: true,
  },
  {
    name: "grasslands-pressure",
    mapType: "grasslands",
    botCount: 8,
    difficulty: 9,
    settleMs: 45000,
    screenshot: "screenshot-02-1920x1080.png",
  },
  {
    name: "desert-expansion",
    mapType: "desert",
    botCount: 7,
    difficulty: 8,
    settleMs: 40000,
    screenshot: "screenshot-03-1920x1080.png",
  },
  {
    name: "islands-fortress",
    mapType: "islands",
    botCount: 4,
    difficulty: 5,
    settleMs: 35000,
    screenshot: "screenshot-04-1920x1080.png",
  },
  {
    name: "random-endurance",
    mapType: "random",
    botCount: 10,
    difficulty: 10,
    settleMs: 50000,
    screenshot: "screenshot-05-1920x1080.png",
  },
];
const requestedScenarios = new Set(
  String(process.env.STORE_CAPTURE_SCENARIOS || "")
    .split(",")
    .map(entry => entry.trim())
    .filter(Boolean)
);
const activeScenarios = requestedScenarios.size
  ? scenarios.filter(scenario => requestedScenarios.has(scenario.name))
  : scenarios;

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function cleanupOutput() {
  if (process.env.STORE_CAPTURE_APPEND !== "1") {
    await fs.rm(screenshotsDir, { recursive: true, force: true });
    await fs.rm(trailerDir, { recursive: true, force: true });
    await fs.rm(videoTempDir, { recursive: true, force: true });
  }
  await Promise.all([
    ensureDir(screenshotsDir),
    ensureDir(trailerDir),
    ensureDir(videoTempDir),
  ]);
}

async function waitForMainMenu(page) {
  await page.waitForSelector('button:has-text("Campaign & Custom")', { timeout: 60000 });
}

function cleanupStaleProcesses() {
  spawnSync("pkill", ["-f", serverEntry], { stdio: "ignore" });
  spawnSync("pkill", ["-f", electronEntry], { stdio: "ignore" });
}

async function waitForGameplay(page) {
  await page.waitForFunction(() => {
    const text = document.body?.innerText ?? "";
    return text.includes("Gold:") && text.includes("Oil:") && !text.includes("STARTING MATCH");
  }, { timeout: 90000 });
}

async function hideStoreNoise(page) {
  await page.evaluate(() => {
    const style = document.createElement("style");
    style.id = "store-capture-style";
    style.textContent = `
      .system-overlay,
      .chat-window,
      .chat-global-toggle-btn,
      .settings-btn,
      .settings-open-btn,
      .wishlist-float-btn,
      .patch-notes-float-btn,
      .connection-lost-overlay,
      [data-debug-overlay="true"] {
        display: none !important;
        visibility: hidden !important;
      }
    `;
    document.head.appendChild(style);
  });
}

async function configureCustomMatch(page, scenario) {
  await page.locator('button:has-text("Campaign & Custom")').first().click();
  await page.waitForSelector(".custom-game-panel", { timeout: 10000 });
  await page.selectOption(".custom-game-panel select", scenario.mapType);
  await page.evaluate(({ botCount, difficulty }) => {
    const ranges = Array.from(document.querySelectorAll(".custom-game-panel input[type='range']"));
    const [botSlider, difficultySlider] = ranges;
    if (!botSlider || !difficultySlider) {
      throw new Error("Could not find custom game sliders.");
    }

    botSlider.value = String(botCount);
    botSlider.dispatchEvent(new Event("input", { bubbles: true }));
    botSlider.dispatchEvent(new Event("change", { bubbles: true }));

    difficultySlider.value = String(difficulty);
    difficultySlider.dispatchEvent(new Event("input", { bubbles: true }));
    difficultySlider.dispatchEvent(new Event("change", { bubbles: true }));
  }, { botCount: scenario.botCount, difficulty: scenario.difficulty });
  await page.locator('button:has-text("Start Custom Game")').first().click();
}

async function startScenario(page, scenario) {
  await waitForMainMenu(page);

  if (scenario.mode === "campaign") {
    await page.locator('button:has-text("Campaign & Custom")').first().click();
    await page.waitForSelector(".campaign-list", { timeout: 10000 });
    await page.locator(".campaign-card", { hasText: scenario.campaignStage }).first().click();
    return;
  }

  await configureCustomMatch(page, scenario);
}

async function maybeConvertTrailer(webmPath) {
  const ffmpegPath = spawnSync("bash", ["-lc", "command -v ffmpeg"], { encoding: "utf8" }).stdout.trim();
  if (!ffmpegPath) {
    return { converted: false, outputPath: webmPath };
  }

  const mp4Path = path.join(trailerDir, "gameplay-trailer.mp4");
  const result = spawnSync(
    ffmpegPath,
    [
      "-y",
      "-i",
      webmPath,
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-c:a",
      "aac",
      mp4Path,
    ],
    { encoding: "utf8" }
  );

  if (result.status !== 0) {
    throw new Error(`ffmpeg failed to convert trailer: ${result.stderr || result.stdout}`);
  }

  return { converted: true, outputPath: mp4Path };
}

async function captureGameplayScreenshot(electronApp, page, outputPath) {
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
    await page.waitForTimeout(1500);
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

async function runScenario(scenario) {
  process.stdout.write(`Running scenario: ${scenario.name}\n`);
  cleanupStaleProcesses();
  const scenarioHome = path.join(clientRoot, "tests", "output", "store-profiles", scenario.name);
  const scenarioPort = String(3800 + scenarios.findIndex(entry => entry.name === scenario.name));
  await ensureDir(scenarioHome);

  const launchOptions = {
    args: [electronEntry],
    env: {
      ...process.env,
      DISABLE_STEAM: "1",
      ENABLE_RUNTIME_DEBUG_LOGS: "0",
      HOME: scenarioHome,
      PORT: scenarioPort,
      ELECTRON_WINDOW_CONTENT_WIDTH: String(screenshotWidth),
      ELECTRON_WINDOW_CONTENT_HEIGHT: String(screenshotHeight),
    },
  };

  if (scenario.recordVideo) {
    launchOptions.recordVideo = { dir: videoTempDir, size: { width: screenshotWidth, height: screenshotHeight } };
  }

  const electronApp = await electron.launch(launchOptions);
  let page;
  let videoHandle = null;
  let screenshotPath = null;

  try {
    page = await electronApp.firstWindow();
    if (scenario.recordVideo && typeof page.video === "function") {
      videoHandle = page.video();
    }
    await startScenario(page, scenario);
    await waitForGameplay(page);
    await hideStoreNoise(page);
    await page.waitForTimeout(scenario.settleMs);

    screenshotPath = path.join(screenshotsDir, scenario.screenshot);
    await captureGameplayScreenshot(electronApp, page, screenshotPath);
  } finally {
    await electronApp.close().catch(() => {});
    cleanupStaleProcesses();
  }

  let trailerInfo = null;
  if (videoHandle) {
    const webmPath = await videoHandle.path();
    const trailerWebmPath = path.join(trailerDir, "gameplay-trailer.webm");
    await fs.copyFile(webmPath, trailerWebmPath);
    trailerInfo = await maybeConvertTrailer(trailerWebmPath);
  }

  process.stdout.write(`Finished scenario: ${scenario.name}\n`);
  return { screenshotPath, trailerInfo };
}

async function runScenarioWithRetry(scenario, maxAttempts = 3) {
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await runScenario(scenario);
    } catch (error) {
      lastError = error;
      process.stderr.write(
        `Scenario ${scenario.name} failed on attempt ${attempt}/${maxAttempts}: ${error instanceof Error ? error.message : String(error)}\n`
      );
      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  }

  throw lastError;
}

async function writeReadme(trailerInfo) {
  const lines = [
    "# Steam Gameplay Capture Pack",
    "",
    "Generated from automated in-engine matches. These assets are intended to replace non-gameplay store screenshots and to provide a real gameplay trailer source for Steam review.",
    "",
    "## Contents",
    "",
    "- `screenshots/`: five gameplay-only screenshots captured from local matches.",
    `- Trailer source: \`${trailerInfo?.converted ? "trailer/gameplay-trailer.mp4" : "trailer/gameplay-trailer.webm"}\``,
    "",
    "## Notes",
    "",
    "- The captures hide the demo/system overlay and other non-gameplay chrome during capture.",
    `- Screenshots are generated at ${screenshotWidth}x${screenshotHeight} content resolution for Steam store compliance.`,
    "- If `ffmpeg` is installed, the trailer is also transcoded to MP4 for easier Steam upload.",
    "- Regenerate with `npm run build:steam-gameplay-assets`.",
    "",
  ];

  await fs.writeFile(path.join(trailerDir, "README.md"), `${lines.join("\n")}`, "utf8");
}

async function main() {
  await cleanupOutput();
  let trailerInfo = null;

  if (requestedScenarios.size > 0 && activeScenarios.length === 0) {
    throw new Error(`No matching store capture scenarios found for: ${Array.from(requestedScenarios).join(", ")}`);
  }

  for (const scenario of activeScenarios) {
    const result = await runScenarioWithRetry(scenario);
    if (result.trailerInfo) {
      trailerInfo = result.trailerInfo;
    }
  }

  await writeReadme(trailerInfo);
  process.stdout.write(`Generated ${activeScenarios.length} gameplay screenshots at ${screenshotsDir}\n`);
  if (trailerInfo) {
    process.stdout.write(`Generated gameplay trailer asset at ${trailerInfo.outputPath}\n`);
  }
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
