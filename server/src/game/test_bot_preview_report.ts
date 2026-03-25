import { mkdirSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { spawnSync } from 'child_process';

type ReportEntry = {
    name: string;
    command: string;
    success: boolean;
    durationMs: number;
    stdout: string;
    stderr: string;
};

type PreviewReport = {
    generatedAt: string;
    outputDir: string;
    entries: ReportEntry[];
};

function runCommand(name: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env): ReportEntry {
    const startedAt = Date.now();
    const child = spawnSync(process.execPath, ['-r', 'ts-node/register', ...args], {
        cwd,
        env,
        encoding: 'utf8',
        maxBuffer: 1024 * 1024 * 20
    });

    return {
        name,
        command: `${process.execPath} -r ts-node/register ${args.join(' ')}`,
        success: child.status === 0,
        durationMs: Date.now() - startedAt,
        stdout: (child.stdout || '').trim(),
        stderr: (child.stderr || '').trim()
    };
}

function renderMarkdown(report: PreviewReport): string {
    const lines: string[] = [];
    lines.push('# Bot Preview Report');
    lines.push('');
    lines.push(`Generated: ${report.generatedAt}`);
    lines.push('');

    const failingEntries = report.entries.filter(entry => !entry.success);
    lines.push('## Summary');
    lines.push('');
    lines.push(`- Passed: ${report.entries.length - failingEntries.length}`);
    lines.push(`- Failed: ${failingEntries.length}`);
    lines.push('');

    if (failingEntries.length > 0) {
        lines.push('## Improvements Required');
        lines.push('');
        failingEntries.forEach(entry => {
            lines.push(`- ${entry.name}`);
        });
        lines.push('');
    }

    lines.push('## Results');
    lines.push('');
    report.entries.forEach(entry => {
        lines.push(`### ${entry.name}`);
        lines.push('');
        lines.push(`- Status: ${entry.success ? 'PASS' : 'FAIL'}`);
        lines.push(`- Duration: ${entry.durationMs}ms`);
        lines.push(`- Command: \`${entry.command}\``);
        lines.push('');
        if (entry.stdout) {
            lines.push('```text');
            lines.push(entry.stdout);
            lines.push('```');
            lines.push('');
        }
        if (entry.stderr) {
            lines.push('```text');
            lines.push(entry.stderr);
            lines.push('```');
            lines.push('');
        }
    });

    return lines.join('\n');
}

function main() {
    const serverRoot = resolve(__dirname, '..', '..');
    const outputDir = join(serverRoot, 'test-results');
    mkdirSync(outputDir, { recursive: true });
    const ladderPairs = process.env.BOT_PREVIEW_LADDER_PAIRS;
    const ladderEnv = ladderPairs
        ? {
              ...process.env,
              BOT_LADDER_PAIRS: ladderPairs
          }
        : process.env;

    const entries: ReportEntry[] = [
        runCommand('Oil Lifecycle', ['src/game/test_oil_structure_lifecycle.ts'], serverRoot),
        runCommand('Difficulty Loading', ['src/game/test_bot_difficulty_loading.ts'], serverRoot),
        runCommand('Difficulty Smoke', ['src/game/test_bot_difficulty_smoke.ts'], serverRoot),
        runCommand('Attack Progression', ['src/game/test_bot_attack_progression.ts'], serverRoot),
        runCommand('Difficulty Ladder', ['src/game/test_bot_difficulty_ladder.ts'], serverRoot, ladderEnv)
    ];

    const report: PreviewReport = {
        generatedAt: new Date().toISOString(),
        outputDir,
        entries
    };

    const jsonPath = join(outputDir, 'bot-preview-report.json');
    const markdownPath = join(outputDir, 'bot-preview-report.md');

    writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    writeFileSync(markdownPath, `${renderMarkdown(report)}\n`, 'utf8');

    console.log(
        JSON.stringify(
            {
                outputDir,
                jsonPath,
                markdownPath,
                passed: entries.filter(entry => entry.success).length,
                failed: entries.filter(entry => !entry.success).length
            },
            null,
            2
        )
    );
}

main();
