import { spawn } from "node:child_process";
import fs from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import { platforms, clientDir, getPlatformTestOutputDir } from "./release-config.mjs";

const smokeTargets = platforms.filter((platform) => platform.key === "windows" || platform.key === "linux");
const nodePath = path.join(clientDir, "node_modules");

async function waitForServerReady(child, label, port, timeoutMs) {
  let stdout = "";
  let stderr = "";
  let exited = false;

  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });

  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const exitPromise = new Promise((resolve) => {
    child.once("exit", (code, signal) => {
      exited = true;
      resolve({ code, signal });
    });
  });

  const startedPromise = new Promise((resolve, reject) => {
    const startedText = `Server is running on port ${port}`;
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (stdout.includes(startedText)) {
        clearInterval(timer);
        resolve({ stdout, stderr });
        return;
      }

      if (Date.now() - startedAt >= timeoutMs) {
        clearInterval(timer);
        reject(new Error(`${label} server did not report readiness within ${timeoutMs}ms.\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`));
      }
    }, 100);

    exitPromise.then(({ code, signal }) => {
      clearInterval(timer);
      reject(
        new Error(
          `${label} server exited before readiness (code=${code ?? "null"}, signal=${signal ?? "null"}).\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`
        )
      );
    });
  });

  const ready = await startedPromise;
  return {
    exited,
    exitPromise,
    ...ready,
  };
}

async function checkHttp(label, port) {
  const response = await fetch(`http://127.0.0.1:${port}/__smoke_missing_asset__`, {
    method: "HEAD",
  });

  if (response.status !== 404) {
    throw new Error(`${label} server expected 404 from smoke probe, received ${response.status}`);
  }
}

async function stopChild(child) {
  if (child.exitCode !== null || child.killed) {
    return;
  }

  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    delay(3000),
  ]);

  if (child.exitCode === null && !child.killed) {
    child.kill("SIGKILL");
    await new Promise((resolve) => child.once("exit", resolve));
  }
}

function writeBackendSmokeReport(platformKey, lines) {
  const outputDir = getPlatformTestOutputDir(platformKey);
  fs.mkdirSync(outputDir, { recursive: true });
  const reportPath = path.join(outputDir, "backend-smoke.txt");
  fs.writeFileSync(reportPath, `${lines.join("\n")}\n`);
  return reportPath;
}

for (const [index, platform] of smokeTargets.entries()) {
  const port = 3911 + index;
  const serverCwd = path.join(platform.stageDir, "resources", "server");
  const child = spawn(process.execPath, ["dist/index.js"], {
    cwd: serverCwd,
    env: {
      ...process.env,
      NODE_ENV: "production",
      NODE_PATH: nodePath,
      PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    await waitForServerReady(child, platform.label, port, 15000);
    await checkHttp(platform.label, port);
    const reportPath = writeBackendSmokeReport(platform.key, [
      `platform=${platform.key}`,
      `cwd=${serverCwd}`,
      `port=${port}`,
      "result=passed",
    ]);
    console.log(`Packaged ${platform.label} backend smoke test passed on port ${port}.`);
    console.log(`Backend smoke report: ${reportPath}`);
  } finally {
    await stopChild(child);
  }
}
