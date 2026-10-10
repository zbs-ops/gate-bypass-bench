import type { Report } from './types.js';

const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

/** A plain-text scorecard: a bypass rate per gate, then the surviving bypasses by mutator. */
export function formatReport(report: Report): string {
  const lines = ['gate-bypass-bench', ''];

  const gateCol = Math.max(...report.scores.map((s) => s.gate.length), 4);
  lines.push(`${'gate'.padEnd(gateCol)}  bypass rate   (bypasses / effective)`);
  for (const s of report.scores) {
    lines.push(
      `${s.gate.padEnd(gateCol)}  ${pct(s.bypassRate).padStart(11)}   (${s.bypasses}/${s.effectiveCommands})`,
    );
  }

  const leaks = report.cells.filter((c) => c.bypass);
  if (leaks.length > 0) {
    lines.push('', 'bypasses that landed:');
    for (const c of leaks) {
      lines.push(`  [${c.gate}] ${c.intent} via ${c.mutator}: ${c.command.replace(/\n/g, '\\n')}`);
    }
  }

  const dudMutators = new Set(
    report.cells.filter((c) => !c.effective).map((c) => `${c.intent}/${c.mutator}`),
  );
  if (dudMutators.size > 0) {
    lines.push(
      '',
      `note: ${dudMutators.size} (intent, mutator) pairs did not reproduce the effect on this`,
      'shell and were excluded from every gate\'s denominator.',
    );
  }

  return lines.join('\n');
}
