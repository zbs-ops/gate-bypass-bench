import { environmentSet, interpreterSet, launcherSet, optionSet, runBench, scriptSet, utilitySet, wrapperSet } from './bench.js';
import { formatReport } from './report.js';

/**
 * Run the benchmark with the built-in intents, mutators, and gates and print the scorecard.
 * `--wrappers` runs the wrapper set (env / command / nice / timeout rewrites); `--scripts`
 * runs the script-file set (the command written into a file and run); `--launchers` runs the
 * launcher set (the command run from find -exec or a git alias); `--interpreters` runs the
 * interpreter set (the command run from a python3 / node / perl one-liner); `--utilities` runs
 * the utility set (the command run from sed's e command, a tar checkpoint, or make --eval); `--options`
 * runs the option set (git --upload-pack, node --import data:, python3 -m timeit); `--environment`
 * runs the environment set (GIT_SSH_COMMAND, NODE_OPTIONS, PERL5OPT in front of git, node, perl).
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
      : process.argv.includes('--launchers')
        ? runBench(launcherSet())
        : process.argv.includes('--interpreters')
          ? runBench(interpreterSet())
          : process.argv.includes('--utilities')
            ? runBench(utilitySet())
            : process.argv.includes('--options')
              ? runBench(optionSet())
              : process.argv.includes('--environment')
                ? runBench(environmentSet())
                : runBench();
  process.stdout.write(formatReport(report) + '\n');
}

main();
