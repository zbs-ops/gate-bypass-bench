import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { makeIntents } from '../src/intents.js';
import {
  makeInterpreterMutators,
  makeLauncherMutators,
  makeMutators,
  makeScriptMutators,
  makeUtilityMutators,
  makeWrapperMutators,
} from '../src/mutators.js';
import { runAndCheck } from '../src/sandbox.js';

const deleteIntent = () => {
  const i = makeIntents().find((x) => x.id === 'delete-protected');
  if (!i) throw new Error('no delete intent');
  return i;
};

describe('mutators preserve the forbidden effect', () => {
  // This is the benchmark's honesty check: a rewrite only counts if it still does the
  // damage. Every mutator must reproduce the delete on this shell, or the scorecard would
  // be crediting gates for blocking commands that were harmless anyway.
  it.each(makeMutators().map((m) => [m.id, m] as const))('%s still deletes', (_id, mutator) => {
    const intent = deleteIntent();
    const command = mutator.render(intent.binary, intent.args);
    const { effective } = runAndCheck(command, intent.setup, intent.effectHappened);
    expect(effective, `command was a no-op: ${command}`).toBe(true);
  });
});

describe('identity mutator', () => {
  it('renders the command verbatim', () => {
    const identity = makeMutators().find((m) => m.id === 'identity');
    expect(identity?.render('rm', ['a', 'b'])).toBe('rm a b');
  });
});

describe('wrapper mutators', () => {
  // Same honesty check, on every intent: a wrapper only counts if the wrapped command still
  // does the damage.
  const cases = makeIntents().flatMap((intent) =>
    makeWrapperMutators().map((m) => [`${m.id} / ${intent.id}`, m, intent] as const),
  );
  it.each(cases)('%s still has the effect', (_name, mutator, intent) => {
    const command = mutator.render(intent.binary, intent.args);
    const { effective } = runAndCheck(command, intent.setup, intent.effectHappened);
    expect(effective, `command was a no-op: ${command}`).toBe(true);
  });

  it('is kept out of the original set, so published scorecards do not move', () => {
    const core = makeMutators().map((m) => m.id);
    expect(makeWrapperMutators().every((m) => !core.includes(m.id))).toBe(true);
    expect(core).toHaveLength(13);
  });
});

describe('script-file mutators', () => {
  // The same honesty check on every intent: writing the command into a script and running
  // the script only counts if the effect still happens.
  const cases = makeIntents().flatMap((intent) =>
    makeScriptMutators().map((m) => [`${m.id} / ${intent.id}`, m, intent] as const),
  );
  it.each(cases)('%s still has the effect', (_name, mutator, intent) => {
    const command = mutator.render(intent.binary, intent.args);
    const { effective } = runAndCheck(command, intent.setup, intent.effectHappened);
    expect(effective, `command was a no-op: ${command}`).toBe(true);
  });

  it('writes its script inside the sandbox, not elsewhere', () => {
    for (const m of makeScriptMutators()) {
      const command = m.render('rm', ['x']);
      expect(command).not.toMatch(/\s\/|\.\.\//); // no absolute or parent paths
    }
  });

  it('only base64-script keeps the binary off the command line', () => {
    const render = (id: string) => makeScriptMutators().find((m) => m.id === id)!.render('rm', ['protected.dat']);
    expect(render('base64-script')).not.toContain('rm');
    expect(render('script-write-run')).toContain('rm protected.dat');
  });

  it('is kept out of the original and wrapper sets, so published scorecards do not move', () => {
    const taken = [...makeMutators(), ...makeWrapperMutators()].map((m) => m.id);
    expect(makeScriptMutators().every((m) => !taken.includes(m.id))).toBe(true);
    expect(makeScriptMutators()).toHaveLength(4);
  });
});

describe('launcher mutators', () => {
  // The same honesty check on every intent: running the command from find or git only counts
  // if the effect still happens.
  const cases = makeIntents().flatMap((intent) =>
    makeLauncherMutators().map((m) => [`${m.id} / ${intent.id}`, m, intent] as const),
  );
  it.each(cases)('%s still has the effect', (_name, mutator, intent) => {
    const command = mutator.render(intent.binary, intent.args);
    const { effective } = runAndCheck(command, intent.setup, intent.effectHappened);
    expect(effective, `command was a no-op: ${command}`).toBe(true);
  });

  it('starts every command with find or git, the program an allowlist would name', () => {
    for (const m of makeLauncherMutators()) {
      expect(m.render('chmod', ['777', 'x']).split(' ')[0]).toMatch(/^(find|git)$/);
    }
  });

  it('keeps find to the sandbox folder, so the command runs once and nowhere else', () => {
    for (const m of makeLauncherMutators().filter((x) => x.id.startsWith('find'))) {
      expect(m.render('chmod', ['777', 'x'])).toMatch(/^find \. -maxdepth 0 /);
    }
  });

  it('is kept out of the other sets, so published scorecards do not move', () => {
    const taken = [...makeMutators(), ...makeWrapperMutators(), ...makeScriptMutators()].map((m) => m.id);
    expect(makeLauncherMutators().every((m) => !taken.includes(m.id))).toBe(true);
    expect(makeLauncherMutators()).toHaveLength(4);
  });
});

describe('interpreter mutators', () => {
  const available = (bin: string): boolean => {
    try {
      execFileSync('sh', ['-c', `command -v ${bin}`], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  };
  // The honesty check, only where the interpreter is installed: a box without one simply drops
  // those renders, the same way the benchmark's effective-only denominator does.
  const cases = makeIntents().flatMap((intent) =>
    makeInterpreterMutators().map((m) => [`${m.id} / ${intent.id}`, m, intent] as const),
  );
  it.each(cases)('%s has the effect where its interpreter is installed', (_name, mutator, intent) => {
    const bin = mutator.render('x', []).split(' ')[0] ?? '';
    if (!available(bin)) return;
    const command = mutator.render(intent.binary, intent.args);
    const { effective } = runAndCheck(command, intent.setup, intent.effectHappened);
    expect(effective, `command was a no-op: ${command}`).toBe(true);
  });

  it('starts every command with an interpreter an allowlist would name', () => {
    for (const m of makeInterpreterMutators()) {
      expect(m.render('chmod', ['777', 'x']).split(' ')[0]).toMatch(/^(python3|node|perl)$/);
    }
  });

  it('is kept out of the other sets, so published scorecards do not move', () => {
    const taken = [...makeMutators(), ...makeWrapperMutators(), ...makeScriptMutators(), ...makeLauncherMutators()].map(
      (m) => m.id,
    );
    expect(makeInterpreterMutators().every((m) => !taken.includes(m.id))).toBe(true);
    expect(makeInterpreterMutators()).toHaveLength(3);
  });
});

describe('utility mutators', () => {
  const available = (bin: string): boolean => {
    try {
      execFileSync('sh', ['-c', `command -v ${bin}`], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  };
  const cases = makeIntents().flatMap((intent) =>
    makeUtilityMutators().map((m) => [`${m.id} / ${intent.id}`, m, intent] as const),
  );
  // Where the program is installed (GNU sed and tar on any Linux box, make where it's there), the
  // command must really have the effect, or the set would be counting no-ops.
  it.each(cases)('%s has the effect where its program is installed', (_name, mutator, intent) => {
    const bin = mutator.render('x', []).split(' ')[0] ?? '';
    if (!available(bin)) return;
    const command = mutator.render(intent.binary, intent.args);
    const { effective } = runAndCheck(command, intent.setup, intent.effectHappened);
    expect(effective, `command was a no-op: ${command}`).toBe(true);
  });

  it('starts every command with sed, tar or make', () => {
    for (const m of makeUtilityMutators()) {
      expect(m.render('chmod', ['777', 'x']).split(' ')[0]).toMatch(/^(sed|tar|make)$/);
    }
  });

  it('is kept out of the other sets, so published scorecards do not move', () => {
    const taken = [
      ...makeMutators(),
      ...makeWrapperMutators(),
      ...makeScriptMutators(),
      ...makeLauncherMutators(),
      ...makeInterpreterMutators(),
    ].map((m) => m.id);
    expect(makeUtilityMutators().every((m) => !taken.includes(m.id))).toBe(true);
    expect(makeUtilityMutators()).toHaveLength(3);
  });
});
