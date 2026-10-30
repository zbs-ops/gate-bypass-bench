import { runBench, scriptSet, wrapperSet } from './bench.js';
import { formatReport } from './report.js';

/**
 * Run the benchmark with the built-in intents, mutators, and gates and print the scorecard.
 * `--wrappers` runs the wrapper set (env / command / nice / timeout rewrites); `--scripts`
 * runs the script-file set (the command written into a file and run).
 *
 * Exit code is 0: the built-in denylist gates are bypassable on purpose, so a non-zero exit
 * would just be noise. To guard a gate of your own in CI, assert its bypass rate in a test
 * (see test/gates.test.ts) rather than relying on this exit code.
 */
function main(): void {
  const report = process.argv.includes('--wrappers')
    ? runBench(wrapperSet())
    : process.argv.includes('--scripts')
      ? runBench(scriptSet())
      : runBench();
  process.stdout.write(formatReport(report) + '\n');
}

main();
