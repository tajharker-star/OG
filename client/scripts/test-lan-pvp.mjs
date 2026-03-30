import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "@playwright/test";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientRoot = path.resolve(__dirname, "..");
const electronEntry = path.join(clientRoot, "electron", "main.cjs");
const serverEntry = path.resolve(clientRoot, "..", "server", "dist", "index.js");
const outputDir = path.join(clientRoot, "tests", "output", "lan-pvp");
const reportPath = path.join(outputDir, "report.md");
const hostShot = path.join(outputDir, "host.png");
const joinShot = path.join(outputDir, "join.png");

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function waitForLobby(page) {
  await page.waitForSelector(".lobby-room-id-text", { timeout: 30000 });
}

async function waitForGameplay(page) {
  await page.waitForFunction(() => {
    const text = document.body?.innerText ?? "";
    return text.includes("Gold:") && text.includes("Oil:") && !text.includes("Loading Lobby");
  }, { timeout: 120000 });
}

function cleanupStaleProcesses() {
  spawnSync("pkill", ["-f", serverEntry], { stdio: "ignore" });
  spawnSync("pkill", ["-f", electronEntry], { stdio: "ignore" });
}

async function main() {
  await ensureDir(outputDir);
  cleanupStaleProcesses();

  const launchOptions = {
    args: [electronEntry],
    env: {
      ...process.env,
      DISABLE_STEAM: "1",
      ENABLE_RUNTIME_DEBUG_LOGS: "0",
      HOME: path.join(clientRoot, "tests", "output", "lan-pvp", "host-home"),
      PORT: "3921",
    },
  };

  const hostApp = await electron.launch(launchOptions);
  let joinApp = null;

  try {
    const hostPage = await hostApp.firstWindow();
    await hostPage.waitForSelector('button:has-text("Multiplayer")', { timeout: 20000 });
    await hostPage.getByRole("button", { name: "Multiplayer", exact: true }).click();
    await hostPage.getByRole("button", { name: "Host Local (LAN)", exact: true }).click();
    await waitForLobby(hostPage);

    const roomId = (await hostPage.locator(".lobby-room-id-text").first().textContent())?.trim() ?? "";
    const lanIp = (await hostPage.locator(".lobby-tunnel-password-val").first().textContent().catch(() => null))?.trim() ?? "unavailable";

    joinApp = await electron.launch({
      ...launchOptions,
      env: {
        ...launchOptions.env,
        HOME: path.join(clientRoot, "tests", "output", "lan-pvp", "join-home"),
      },
    });
    const joinPage = await joinApp.firstWindow();
    await joinPage.waitForSelector('button:has-text("Multiplayer")', { timeout: 20000 });
    await joinPage.getByRole("button", { name: "Multiplayer", exact: true }).click();
    await joinPage.locator('input[placeholder="Room ID or Join Code"]').fill(roomId);
    await joinPage.getByRole("button", { name: "Join", exact: true }).click();
    await waitForLobby(joinPage);

    const startButton = hostPage.getByRole("button", { name: "Start Match Now", exact: true });
    if (await startButton.isVisible().catch(() => false)) {
      await startButton.click();
    }

    await Promise.all([waitForGameplay(hostPage), waitForGameplay(joinPage)]);

    await hostPage.screenshot({ path: hostShot });
    await joinPage.screenshot({ path: joinShot });

    const hostText = (await hostPage.textContent("body")) ?? "";
    const joinText = (await joinPage.textContent("body")) ?? "";

    const lines = [
      "# LAN PVP Validation",
      "",
      "Status: PASS",
      "",
      `- Room ID created: \`${roomId}\``,
      `- LAN IP exposed by host: \`${lanIp}\``,
      "- Host launched a LAN match.",
      "- Second local client joined via room ID.",
      "- Host force-started the match.",
      "- Both clients reached live gameplay UI with resource HUD visible.",
      "",
      "Artifacts:",
      `- Host screenshot: \`${hostShot}\``,
      `- Joiner screenshot: \`${joinShot}\``,
      "",
      "Host text preview:",
      "```text",
      hostText.slice(0, 800).trim(),
      "```",
      "",
      "Joiner text preview:",
      "```text",
      joinText.slice(0, 800).trim(),
      "```",
      "",
    ];

    await fs.writeFile(reportPath, lines.join("\n"), "utf8");
    process.stdout.write(`LAN PVP validation passed. Report: ${reportPath}\n`);
  } finally {
    await hostApp.close().catch(() => {});
    if (joinApp) {
      await joinApp.close().catch(() => {});
    }
    cleanupStaleProcesses();
  }
}

main().catch(async error => {
  await ensureDir(outputDir);
  const body = `# LAN PVP Validation\n\nStatus: FAIL\n\n\`\`\`\n${error instanceof Error ? error.stack ?? error.message : String(error)}\n\`\`\`\n`;
  await fs.writeFile(reportPath, body, "utf8");
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
