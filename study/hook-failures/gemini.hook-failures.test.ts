/**
 * What Gemini CLI does with a BeforeTool hook that misbehaves.
 *
 * CI copies this file into google-gemini/gemini-cli at packages/core/src/hooks/ and runs it with
 * Gemini's own vitest. Each case is a real shell script spawned by Gemini's HookRunner, and the
 * result goes through HookAggregator, then the same three checks the scheduler makes before a
 * tool runs (scheduler/hook-utils.ts: shouldStopExecution, getBlockingError, isAskDecision).
 *
 * Writes {case: "BLOCKED" | "ASKS" | "RUNS"} to $HOOK_STUDY_OUT.
 */
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import type { Config } from '../config/config.js';
import { HookAggregator } from './hookAggregator.js';
import { HookRunner } from './hookRunner.js';
import { ConfigSource, HookEventName, HookType, type HookConfig, type HookInput } from './types.js';

const out = process.env['HOOK_STUDY_OUT'];
const casesPath = process.env['HOOK_STUDY_CASES'];
if (!out || !casesPath) throw new Error('set HOOK_STUDY_OUT and HOOK_STUDY_CASES');

const SCRIPTS: Record<string, string> = {
  deny: `printf '%s' '{"decision":"deny","reason":"blocked by policy"}'`,
  ask: `printf '%s' '{"decision":"ask","reason":"please confirm"}'`,
  allow: `printf '%s' '{"decision":"allow"}'`,
  nothing: `exit 0`,
  crash: `exit 1`,
  'exit2-reason': `echo 'blocked by policy' >&2; exit 2`,
  'exit2-silent': `exit 2`,
  'bad-json': `printf '%s' '{"decision": "deny", '`,
  // BeforeTool doesn't use clearContext (an AfterAgent field).
  'deny-extra-field': `printf '%s' '{"decision":"deny","reason":"blocked by policy","hookSpecificOutput":{"clearContext":true}}'`,
  timeout: `sleep 5`,
};

const dir = mkdtempSync(join(tmpdir(), 'hook-study-'));
const config = {
  isTrustedFolder: () => true,
  sanitizationConfig: { enableEnvironmentVariableRedaction: true },
  storage: { getPlansDir: () => join(dir, 'plans') },
} as unknown as Config;

const input = {
  session_id: 'study',
  transcript_path: join(dir, 'transcript.json'),
  cwd: dir,
  hook_event_name: HookEventName.BeforeTool,
  timestamp: new Date().toISOString(),
  tool_name: 'run_shell_command',
  tool_input: { command: 'rm -rf build' },
} as HookInput;

it('records what Gemini CLI does for each hook behaviour', async () => {
  const cases = JSON.parse(readFileSync(casesPath, 'utf8')) as Array<{ id: string }>;
  const results: Record<string, string> = {};
  for (const { id } of cases) {
    const script = join(dir, `${id}.sh`);
    writeFileSync(script, `#!/bin/sh\ncat > /dev/null\n${SCRIPTS[id]}\n`);
    chmodSync(script, 0o755);
    const hook = {
      type: HookType.Command,
      name: id,
      command: script,
      timeout: 1000,
      source: ConfigSource.User,
    } as HookConfig;
    const result = await new HookRunner(config).executeHook(hook, HookEventName.BeforeTool, input);
    const final = new HookAggregator().aggregateResults([result], HookEventName.BeforeTool).finalOutput;
    results[id] =
      final?.shouldStopExecution() || final?.getBlockingError().blocked
        ? 'BLOCKED'
        : final?.isAskDecision()
          ? 'ASKS'
          : 'RUNS';
  }
  writeFileSync(out, JSON.stringify(results, null, 2) + '\n');
  expect(results['deny']).toBe('BLOCKED'); // the control must hold, or the harness is wrong
}, 60_000);
