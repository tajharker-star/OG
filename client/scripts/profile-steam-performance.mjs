import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { _electron as electron } from '@playwright/test';

const clientDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const outputDir = path.join(clientDir, 'tests', 'output', 'perf');
const outputStamp = new Date().toISOString().replace(/[:.]/g, '-');
const outputJsonPath = path.join(outputDir, `steam-perf-${outputStamp}.json`);
const outputSummaryPath = path.join(outputDir, `steam-perf-${outputStamp}.txt`);
const lobbyProfileMs = Number.parseInt(process.env.AG_PERF_LOBBY_MS || '25000', 10);
const matchProfileMs = Number.parseInt(process.env.AG_PERF_MATCH_MS || '45000', 10);

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values, percentileValue) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(0, Math.min(sorted.length - 1, Math.ceil((percentileValue / 100) * sorted.length) - 1));
  return sorted[rank];
}

function summarizePhase(samples) {
  const fpsValues = samples.map((sample) => sample.fps).filter((value) => Number.isFinite(value) && value > 0);
  const pingValues = samples.map((sample) => sample.pingMs).filter((value) => Number.isFinite(value) && value > 0);
  const memoryValues = samples.map((sample) => sample.memoryMb).filter((value) => Number.isFinite(value) && value > 0);

  return {
    samples: samples.length,
    fps: {
      avg: Number(mean(fpsValues).toFixed(2)),
      min: fpsValues.length ? Math.min(...fpsValues) : 0,
      p95: Number(percentile(fpsValues, 95).toFixed(2)),
      below30: fpsValues.filter((value) => value < 30).length,
      below45: fpsValues.filter((value) => value < 45).length,
    },
    ping: {
      avg: Number(mean(pingValues).toFixed(2)),
      min: pingValues.length ? Math.min(...pingValues) : 0,
      p95: Number(percentile(pingValues, 95).toFixed(2)),
      above120: pingValues.filter((value) => value > 120).length,
      above180: pingValues.filter((value) => value > 180).length,
    },
    memory: {
      avgMb: Number(mean(memoryValues).toFixed(2)),
      maxMb: memoryValues.length ? Math.max(...memoryValues) : 0,
    },
  };
}

async function waitForButtonEnabled(page, label, timeoutMs = 120000) {
  await page.waitForFunction(
    (text) => {
      const button = Array.from(document.querySelectorAll('button')).find((candidate) =>
        candidate.textContent?.replace(/\s+/g, ' ').trim().includes(text)
      );
      return Boolean(button && !(button).disabled);
    },
    label,
    { timeout: timeoutMs }
  );
}

async function clickButton(page, label) {
  await page.evaluate((text) => {
    const button = Array.from(document.querySelectorAll('button')).find((candidate) =>
      candidate.textContent?.replace(/\s+/g, ' ').trim().includes(text)
    );
    if (!button || button.disabled) {
      throw new Error(`Button not found or disabled: ${text}`);
    }
    button.click();
  }, label);
}

async function runCameraSweep(page, durationMs) {
  const keys = ['w', 'a', 's', 'd', 'ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'];
  const start = Date.now();
  let keyIndex = 0;
  while (Date.now() - start < durationMs) {
    const key = keys[keyIndex % keys.length];
    keyIndex += 1;
    await page.keyboard.down(key);
    await delay(240);
    await page.keyboard.up(key);
    await delay(120);
  }
}

async function main() {
  ensureDir(outputDir);

  const electronApp = await electron.launch({
    args: [path.join(clientDir, 'electron', 'main.cjs')],
    env: {
      ...process.env,
      AG_PERF_PROFILE: '1',
      ENABLE_RUNTIME_DEBUG_LOGS: '1',
      // Keep Steam enabled for this profiling pass.
      DISABLE_STEAM: process.env.DISABLE_STEAM === '1' ? '1' : '0',
      PORT: process.env.PORT || '3001',
    },
  });

  const page = await electronApp.firstWindow();
  await page.waitForSelector('body', { timeout: 60000 });
  await page.evaluate(() => {
    localStorage.setItem('ag_perf_profile', '1');
    window.__agPerfSamples = [];
  });

  const steamRequiredVisible = await page
    .locator('text=Steam Required')
    .isVisible({ timeout: 2000 })
    .catch(() => false);
  if (steamRequiredVisible) {
    throw new Error('Steam Required modal is visible. Launch Steam and rerun profiling.');
  }

  await waitForButtonEnabled(page, 'Campaign & Custom');

  // Lobby profile window
  await delay(Math.max(3000, lobbyProfileMs));

  // Start a custom local match for in-game profiling
  await clickButton(page, 'Campaign & Custom');
  await waitForButtonEnabled(page, 'Start Custom Game');
  await clickButton(page, 'Start Custom Game');

  // Wait for in-game HUD to appear
  await page.waitForFunction(
    () => document.body.innerText.includes('PING:'),
    { timeout: 120000 }
  );

  // Simulate normal camera movement while gathering samples
  await runCameraSweep(page, Math.max(5000, matchProfileMs));

  const perfSamples = await page.evaluate(() => {
    const value = (window).__agPerfSamples;
    return Array.isArray(value) ? value : [];
  });

  await page.screenshot({ path: path.join(outputDir, `steam-perf-${outputStamp}.png`) });
  await electronApp.close();

  const lobbySamples = perfSamples.filter((sample) => sample.phase === 'lobby');
  const matchSamples = perfSamples.filter((sample) => sample.phase === 'match');
  const summary = {
    generatedAt: new Date().toISOString(),
    sampleCount: perfSamples.length,
    lobby: summarizePhase(lobbySamples),
    match: summarizePhase(matchSamples),
    steamInitializedSamples: perfSamples.filter((sample) => sample.steamInitialized).length,
    nonSteamSamples: perfSamples.filter((sample) => !sample.steamInitialized).length,
  };

  fs.writeFileSync(
    outputJsonPath,
    JSON.stringify(
      {
        summary,
        samples: perfSamples,
      },
      null,
      2
    )
  );

  const summaryLines = [
    `generated_at=${summary.generatedAt}`,
    `sample_count=${summary.sampleCount}`,
    `steam_initialized_samples=${summary.steamInitializedSamples}`,
    `non_steam_samples=${summary.nonSteamSamples}`,
    '',
    '[lobby]',
    `samples=${summary.lobby.samples}`,
    `fps_avg=${summary.lobby.fps.avg}`,
    `fps_p95=${summary.lobby.fps.p95}`,
    `fps_min=${summary.lobby.fps.min}`,
    `fps_below_30=${summary.lobby.fps.below30}`,
    `ping_avg=${summary.lobby.ping.avg}`,
    `ping_p95=${summary.lobby.ping.p95}`,
    `ping_above_120=${summary.lobby.ping.above120}`,
    `memory_avg_mb=${summary.lobby.memory.avgMb}`,
    `memory_max_mb=${summary.lobby.memory.maxMb}`,
    '',
    '[match]',
    `samples=${summary.match.samples}`,
    `fps_avg=${summary.match.fps.avg}`,
    `fps_p95=${summary.match.fps.p95}`,
    `fps_min=${summary.match.fps.min}`,
    `fps_below_30=${summary.match.fps.below30}`,
    `ping_avg=${summary.match.ping.avg}`,
    `ping_p95=${summary.match.ping.p95}`,
    `ping_above_120=${summary.match.ping.above120}`,
    `memory_avg_mb=${summary.match.memory.avgMb}`,
    `memory_max_mb=${summary.match.memory.maxMb}`,
    '',
    `json=${outputJsonPath}`,
  ];
  fs.writeFileSync(outputSummaryPath, `${summaryLines.join('\n')}\n`);

  console.log('Steam performance profile complete.');
  console.log(`Summary: ${outputSummaryPath}`);
  console.log(`Raw JSON: ${outputJsonPath}`);
}

main().catch((error) => {
  console.error('Steam performance profile failed:', error);
  process.exit(1);
});
