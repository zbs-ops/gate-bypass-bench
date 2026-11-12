import { describe, expect, it } from 'vitest';

import * as pkg from '../src/index.js';

describe('the package entry point', () => {
  // Every extended set has to be reachable from the package, not only from src/bench.ts: the
  // product studies import from here. The environment set shipped without its export once.
  it('exports every attack set and its mutators', () => {
    for (const name of ['wrapperSet', 'scriptSet', 'launcherSet', 'interpreterSet', 'utilitySet', 'optionSet', 'environmentSet', 'manifestSet']) {
      expect(typeof (pkg as Record<string, unknown>)[name], name).toBe('function');
    }
    for (const name of [
      'makeWrapperMutators',
      'makeScriptMutators',
      'makeLauncherMutators',
      'makeInterpreterMutators',
      'makeUtilityMutators',
      'makeOptionMutators',
      'makeEnvironmentMutators',
      'makeManifestMutators',
    ]) {
      expect(typeof (pkg as Record<string, unknown>)[name], name).toBe('function');
    }
  });
});
