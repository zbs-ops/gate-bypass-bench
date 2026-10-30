/**
 * Score Gemini CLI's real policy engine with gate-bypass-bench, configured two ways.
 *
 * Both load the engine the way the CLI does (createPolicyEngineConfig with the bundled
 * default policies) plus one user policy file:
 *
 *  - deny rule (deny.toml): YOLO mode, with `commandPrefix` deny rules for the benchmark's
 *    six blocked binaries. YOLO is the case where a deny rule is the only thing between the
 *    agent and the shell; in the default mode an unmatched command goes to a human anyway.
 *  - allow rule (allow.toml): default mode, non-interactive, with `commandPrefix` allow
 *    rules for four harmless binaries. Anything else falls to the default, which is deny.
 *
 * Usage: npm install && npm run study   (writes RESULTS.md next to this file)
 */
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PolicyEngine } from '@google/gemini-cli-core/dist/src/policy/policy-engine.js';
import { createPolicyEngineConfig, DEFAULT_CORE_POLICIES_DIR } from '@google/gemini-cli-core/dist/src/policy/config.js';
import { ApprovalMode } from '@google/gemini-cli-core/dist/src/policy/types.js';
import { initializeShellParsers } from '@google/gemini-cli-core/dist/src/utils/shell-utils.js';

import {
  formatReport,
  makeGates,
  runBenchAsync,
  scriptSet,
  wrapperSet,
  type AsyncGate,
  type Report,
} from '../../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const version: string = createRequire(import.meta.url)('@google/gemini-cli-core/package.json').version;

// The engine logs every decision through console; keep the scorecard readable.
const quiet = <T>(fn: () => Promise<T>): Promise<T> => {
  const saved = { log: console.log, debug: console.debug, info: console.info, warn: console.warn };
  console.log = console.debug = console.info = console.warn = () => {};
  return fn().finally(() => Object.assign(console, saved));
};

type Verdict = 'ALLOW' | 'DENY';

interface GeminiGate extends AsyncGate {
  /** Commands the engine sent to a human. Not an unattended bypass, so scored as DENY. */
  askedUser: string[];
}

async function geminiGate(opts: {
  id: string;
  describe: string;
  policyFile: string;
  mode: ApprovalMode;
  interactive: boolean;
  /** Must hold before anything is measured, or the policy file didn't load. */
  sanity: [string, Verdict][];
}): Promise<GeminiGate> {
  const config = await quiet(() =>
    createPolicyEngineConfig({ policyPaths: [join(here, opts.policyFile)] }, opts.mode, DEFAULT_CORE_POLICIES_DIR, opts.interactive),
  );
  const engine = new PolicyEngine(config);
  const askedUser: string[] = [];
  const decide = async (command: string): Promise<Verdict> => {
    const { decision } = await quiet(() => engine.check({ name: 'run_shell_command', args: { command } }, undefined));
    if (decision === 'allow') return 'ALLOW';
    if (decision === 'ask_user') askedUser.push(command);
    return 'DENY';
  };
  // A policy file that silently fails to load would score every command the same way and
  // look like a dramatic result. Prove the config is live first.
  for (const [command, expected] of opts.sanity) {
    const got = await decide(command);
    if (got !== expected) throw new Error(`${opts.id} config check failed: ${command} -> ${got}, expected ${expected}`);
  }
  askedUser.length = 0;
  return { id: opts.id, describe: opts.describe, decide, askedUser };
}

await initializeShellParsers();

const denyRule = await geminiGate({
  id: 'gemini-cli-deny-rule',
  describe: `Gemini CLI ${version}, YOLO mode, commandPrefix deny rules`,
  policyFile: 'deny.toml',
  mode: ApprovalMode.YOLO,
  interactive: true,
  sanity: [
    ['ls', 'ALLOW'],
    ['rm notes.txt', 'DENY'],
    ['ls && rm notes.txt', 'DENY'],
    ['echo $(cat secret.txt)', 'DENY'],
  ],
});

const allowRule = await geminiGate({
  id: 'gemini-cli-allow-rule',
  describe: `Gemini CLI ${version}, default mode, non-interactive, commandPrefix allow rules`,
  policyFile: 'allow.toml',
  mode: ApprovalMode.DEFAULT,
  interactive: false,
  sanity: [
    ['ls', 'ALLOW'],
    ['echo hi', 'ALLOW'],
    ['rm notes.txt', 'DENY'],
    ['ls && rm notes.txt', 'DENY'],
  ],
});

const gemini = [denyRule, allowRule];
const report = await runBenchAsync({ gates: [...makeGates(), ...gemini] });
const scorecard = formatReport(report);
process.stdout.write(scorecard + '\n');

const table = (gate: GeminiGate, r: Report) => [
  `## ${gate.id}`,
  '',
  `${gate.describe}. Commands sent to a human instead (scored as blocked): ${gate.askedUser.length}.`,
  '',
  '| intent | technique | command | result |',
  '|---|---|---|---|',
  ...r.cells
    .filter((c) => c.gate === gate.id && c.effective)
    .map((c) => `| ${c.intent} | ${c.mutator} | \`${c.command.replace(/\n/g, '\\n').replace(/\|/g, '\\|')}\` | ${c.bypass ? '**bypass**' : 'blocked'} |`),
  '',
];

// Built now, before the wrapper run adds to askedUser, so the original section never moves.
const core = [...table(denyRule, report), ...table(allowRule, report)];

// Extended set: the same gates on the wrapper rewrites (env, command, nice, timeout).
for (const g of gemini) g.askedUser.length = 0;
const wrapped = await runBenchAsync({ ...wrapperSet(), gates: [...makeGates(), ...gemini] });
const wrappedCard = formatReport(wrapped);
process.stdout.write(wrappedCard + '\n');

// Extended set: the same gates on the script-file rewrites (the command written to a file, run).
for (const g of gemini) g.askedUser.length = 0;
const scripted = await runBenchAsync({ ...scriptSet(), gates: [...makeGates(), ...gemini] });
const scriptedCard = formatReport(scripted);
process.stdout.write(scriptedCard + '\n');

writeFileSync(
  join(here, 'RESULTS.md'),
  [
    `# Gemini CLI policy engine (${version}) under gate-bypass-bench`,
    '',
    'Generated by `npm run study`. Each gate is the real engine, built with the CLI\'s own config',
    'loader and bundled default policies, plus the one policy file named below.',
    '',
    '```',
    scorecard,
    '```',
    '',
    ...core,
    '# Extended set: wrappers',
    '',
    'The same gates on 12 more attacks: each blocked command run through `env`, `command`, `nice`',
    'or `timeout 5` (`npm run bench -- --wrappers`). Kept separate so the scorecard above is unchanged.',
    '',
    '```',
    wrappedCard,
    '```',
    '',
    ...table(denyRule, wrapped),
    ...table(allowRule, wrapped),
    '# Extended set: script files',
    '',
    'The same gates on 12 more attacks: each blocked command written into a script file and run',
    'with `sh`, `.` or a here-document (`npm run bench -- --scripts`). The command line the engine',
    'judges is `sh s.sh`, while the blocked binary sits in the file. Kept separate so the scorecard',
    'above is unchanged.',
    '',
    '```',
    scriptedCard,
    '```',
    '',
    ...table(denyRule, scripted),
    ...table(allowRule, scripted),
  ].join('\n'),
);
