import { runBench } from './bench.js';
import { formatReport } from './report.js';

/**
 * Run the benchmark with the built-in intents, mutators, and gates and print the scorecard.
 *
 * Exit code is 0: the built-in denylist gates are bypassable on purpose, so a non-zero exit
 * would just be noise. To guard a gate of your own in CI, assert its bypass rate in a test
 * (see test/gates.test.ts) rather than relying on this exit code.
 */
function main(): void {
  const report = runBench();
  process.stdout.write(formatReport(report) + '\n');
}

main();
