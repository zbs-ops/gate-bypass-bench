import { makeGates } from './gates.js';
import { makeIntents } from './intents.js';
import { makeMutators, makeWrapperMutators } from './mutators.js';
import { runAndCheck } from './sandbox.js';
import type { AsyncGate, Cell, GateScore, Intent, Mutator, Gate, Report } from './types.js';

export interface BenchOptions {
  intents?: Intent[];
  mutators?: Mutator[];
  gates?: Gate[];
}

export interface AsyncBenchOptions {
  intents?: Intent[];
  mutators?: Mutator[];
  gates?: AsyncGate[];
}

/** One attack command, already run once in the sandbox to learn if it does the damage. */
interface Attack {
  intent: string;
  technique: string;
  command: string;
  effective: boolean;
}

/**
 * Two kinds of attack per intent: re-spellings of the blocked binary (mutators), and whole
 * commands that reach the same effect with a different binary (equivalents). Each is run
 * once, whatever the number of gates, because the effect doesn't depend on the gate.
 */
function runAttacks(intents: Intent[], mutators: Mutator[]): Attack[] {
  const attacks: Attack[] = [];
  for (const intent of intents) {
    const commands = [
      ...mutators.map((m) => ({ technique: m.id, command: m.render(intent.binary, intent.args) })),
      ...(intent.equivalents ?? []).map((command) => ({
        technique: `equivalent:${command.trim().split(/\s+/)[0]}`,
        command,
      })),
    ];
    for (const { technique, command } of commands) {
      const { effective } = runAndCheck(command, intent.setup, intent.effectHappened);
      attacks.push({ intent: intent.id, technique, command, effective });
    }
  }
  return attacks;
}

/** A third answer (ASK_USER, undefined) is a gate the bench can't score, so it stops here. */
function checkVerdict(gate: AsyncGate, command: string, verdict: unknown): 'ALLOW' | 'DENY' {
  if (verdict === 'ALLOW' || verdict === 'DENY') return verdict;
  throw new Error(`gate ${gate.id} returned ${String(verdict)} for ${JSON.stringify(command)}`);
}

function cell(attack: Attack, gate: AsyncGate, verdict: 'ALLOW' | 'DENY'): Cell {
  return {
    intent: attack.intent,
    mutator: attack.technique,
    gate: gate.id,
    command: attack.command,
    effective: attack.effective,
    verdict,
    bypass: verdict === 'ALLOW' && attack.effective,
  };
}

function score(cells: Cell[], gates: AsyncGate[]): GateScore[] {
  return gates.map((gate) => {
    const effectiveCells = cells.filter((c) => c.gate === gate.id && c.effective);
    const bypasses = effectiveCells.filter((c) => c.bypass).length;
    return {
      gate: gate.id,
      effectiveCommands: effectiveCells.length,
      bypasses,
      bypassRate: effectiveCells.length === 0 ? 0 : bypasses / effectiveCells.length,
    };
  });
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
  const gates = options.gates ?? makeGates();
  const attacks = runAttacks(options.intents ?? makeIntents(), options.mutators ?? makeMutators());
  const cells = attacks.flatMap((a) => gates.map((g) => cell(a, g, checkVerdict(g, a.command, g.decide(a.command)))));
  return { cells, scores: score(cells, gates) };
}

/**
 * Same matrix and same scoring as `runBench`, for gates that answer with a promise. A gate
 * that throws makes the whole run reject with the gate's id: a benchmark that quietly
 * counted errors as ALLOW or DENY would be measuring the error handling, not the gate.
 */
export async function runBenchAsync(options: AsyncBenchOptions = {}): Promise<Report> {
  const gates: AsyncGate[] = options.gates ?? makeGates();
  const attacks = runAttacks(options.intents ?? makeIntents(), options.mutators ?? makeMutators());
  const cells: Cell[] = [];
  for (const attack of attacks) {
    for (const gate of gates) {
      let verdict: unknown;
      try {
        verdict = await gate.decide(attack.command);
      } catch (err) {
        throw new Error(`gate ${gate.id} threw on ${JSON.stringify(attack.command)}: ${(err as Error).message}`);
      }
      cells.push(cell(attack, gate, checkVerdict(gate, attack.command, verdict)));
    }
  }
  return { cells, scores: score(cells, gates) };
}

/**
 * The extended set: every intent through the wrapper rewrites only. Equivalents are left out
 * because the original set already runs them, so each attack is counted once.
 */
export function wrapperSet(): { intents: Intent[]; mutators: Mutator[] } {
  return {
    intents: makeIntents().map((intent) => ({ ...intent, equivalents: [] })),
    mutators: makeWrapperMutators(),
  };
}
