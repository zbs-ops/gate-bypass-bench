import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { README_END, README_START, twoStepRows, twoStepSummary } from '../study/two-step-summary.js';

const root = join(__dirname, '..');

describe('the two-step summary in the README', () => {
  // The README table is built from the three products' own verdict files, so it can't drift from
  // what was measured: rerun `npx tsx study/two-step-summary.ts --write` after a study changes.
  it('matches what the three studies measured', () => {
    const readme = readFileSync(join(root, 'README.md'), 'utf8');
    const start = readme.indexOf(README_START);
    const end = readme.indexOf(README_END);
    expect(start, 'README has the start marker').toBeGreaterThan(-1);
    expect(end, 'README has the end marker').toBeGreaterThan(start);
    expect(readme.slice(start, end + README_END.length)).toBe(twoStepSummary(root));
  });

  it('reads every renamed or moved build file for every product', () => {
    const rows = twoStepRows(root);
    expect(rows.map((r) => r.file)).toEqual(['build.txt', 'Makefile.ci', 'recipes.inc', 'mk/steps', 'sub/Makefile', 'sub/package.json']);
    // Gemini's study covers the first four files; the subfolder ones were measured in opencode and Codex only.
    expect(rows.map((r) => r.gemini)).toEqual(['runs', 'runs', 'runs', 'runs', 'not measured', 'not measured']);
    for (const r of rows) {
      expect(r.opencode).toBe('runs');
      expect(r.codexPlain).toBe('runs in the sandbox');
      expect(r.codexMake).toBe('runs');
    }
  });

  it('says a step that asks or is refused stops the attack', () => {
    const rows = twoStepRows(root, {
      gemini: { 'build.txt': { write: 'DENY', run: 'ALLOW' } },
      opencodeRun: { 'make -f build.txt gbb': 'ask' },
      codexPlainRun: { 'make -f build.txt gbb': 'prompt' },
    });
    const row = rows.find((r) => r.file === 'build.txt');
    expect(row).toMatchObject({ gemini: 'stopped (write)', opencode: 'stopped (run)', codexPlain: 'stopped (run)' });
  });
});
