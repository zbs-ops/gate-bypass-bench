import { makeGates } from './gates.js';
import { makeIntents } from './intents.js';
import { makeMutators } from './mutators.js';
import { runAndCheck } from './sandbox.js';
import type { Cell, GateScore, Intent, Mutator, Gate, Report } from './types.js';

export interface BenchOptions {
  intents?: Intent[];
  mutators?: Mutator[];
  gates?: Gate[];
}

/**
 * Run every (intent × mutator) pair once to learn whether the rewrite actually causes the
 * forbidden effect, then ask each gate for a verdict on the same command string.
 *
 * A bypass is counted only when BOTH are true: the gate allowed the command, and running
 * it caused the effect. A rewrite the shell mangles into a no-op is not scored against any
 * gate, which is why the denominator is "effective commands", not "all commands".
 */
export function runBench(options: BenchOptions = {}): Report {
  const intents = options.intents ?? makeIntents();
  const mutators = options.mutators ?? makeMutators();
  const gates = options.gates ?? makeGates();

  const cells: Cell[] = [];

  for (const intent of intents) {
    // Two kinds of attack per intent: re-spellings of the blocked binary (mutators), and
    // whole commands that reach the same effect with a different binary (equivalents).
    const attacks: { technique: string; command: string }[] = [
      ...mutators.map((m) => ({ technique: m.id, command: m.render(intent.binary, intent.args) })),
      ...(intent.equivalents ?? []).map((command) => ({
        technique: `equivalent:${command.trim().split(/\s+/)[0]}`,
        command,
      })),
    ];

    for (const attack of attacks) {
      const { effective } = runAndCheck(attack.command, intent.setup, intent.effectHappened);
      for (const gate of gates) {
        const verdict = gate.decide(attack.command);
        cells.push({
          intent: intent.id,
          mutator: attack.technique,
          gate: gate.id,
          command: attack.command,
          effective,
          verdict,
          bypass: verdict === 'ALLOW' && effective,
        });
      }
    }
  }

  const scores: GateScore[] = gates.map((gate) => {
    const effectiveCells = cells.filter((c) => c.gate === gate.id && c.effective);
    const bypasses = effectiveCells.filter((c) => c.bypass).length;
    return {
      gate: gate.id,
      effectiveCommands: effectiveCells.length,
      bypasses,
      bypassRate: effectiveCells.length === 0 ? 0 : bypasses / effectiveCells.length,
    };
  });

  return { cells, scores };
}
