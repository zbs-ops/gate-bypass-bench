/**
 * What opencode does with a `tool.execute.before` plugin hook that misbehaves.
 *
 * opencode's safety hooks are plugins: JavaScript loaded in-process, not commands. There is no
 * "deny" answer; a plugin blocks a call by throwing. CI copies this file into an opencode
 * checkout at packages/opencode/test/plugin/ and runs it with bun, reusing the setup of
 * opencode's own plugin tests (test/plugin/trigger.test.ts): each behaviour is a real plugin
 * file loaded through opencode.json, and `plugin.trigger("tool.execute.before", ...)` is the
 * same call opencode makes before every tool runs (src/session/tools.ts). A failed trigger
 * stops the tool there; opencode's own code-mode test asserts the same.
 *
 * Writes {case: "BLOCKED" | "RUNS" | "RUNS_REWRITTEN" | "HANGS"} to $HOOK_STUDY_OUT.
 */
import { afterAll, describe, expect } from "bun:test"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect, Exit } from "effect"
import fs from "fs"
import path from "path"
import { pathToFileURL } from "url"
import { Account } from "../../src/account/account"
import { Auth } from "../../src/auth"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { Plugin } from "../../src/plugin/index"
import { AccountTest } from "../fake/account"
import { AuthTest } from "../fake/auth"
import { NpmTest } from "../fake/npm"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { Npm } from "@opencode-ai/core/npm"

const out = process.env["HOOK_STUDY_OUT"]
if (!out) throw new Error("set HOOK_STUDY_OUT")

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Plugin.node, CrossSpawnSpawner.node]), [
    [Auth.node, AuthTest.empty],
    [Account.node, AccountTest.empty],
    [Npm.node, NpmTest.noop],
    [RuntimeFlags.node, RuntimeFlags.layer({ disableDefaultPlugins: true })],
  ]),
)

// The body of the plugin's tool.execute.before hook for each behaviour.
const CASES: Record<string, string> = {
  throws: 'throw new Error("blocked by policy")',
  rejects: 'await Promise.reject(new Error("blocked by policy"))',
  nothing: "return",
  rewrites: 'output.args.command = "echo blocked"',
  hangs: "await new Promise(() => {})",
}

const COMMAND = "rm -rf build"
const results: Record<string, string> = {}

function withPlugin<A, E, R>(body: string, self: Effect.Effect<A, E, R>) {
  return Effect.gen(function* () {
    const test = yield* TestInstance
    const file = path.join(test.directory, "plugin.ts")
    const source = `export default async () => ({\n  "tool.execute.before": async (input, output) => {\n    ${body}\n  },\n})\n`
    yield* Effect.promise(() => Bun.write(file, source))
    yield* Effect.promise(() =>
      Bun.write(
        path.join(test.directory, "opencode.json"),
        JSON.stringify({ $schema: "https://opencode.ai/config.json", plugin: [pathToFileURL(file).href] }),
      ),
    )
    return yield* self
  })
}

const beforeTool = Effect.fn("HookStudy.beforeTool")(function* () {
  const plugin = yield* Plugin.Service
  const output = { args: { command: COMMAND } as { command: string } }
  const exit = yield* plugin
    .trigger("tool.execute.before", { tool: "bash", sessionID: "study", callID: "call_1" }, output)
    .pipe(
      Effect.as("returned" as const),
      // opencode sets no timeout on plugin hooks; this only lets the study report a hang.
      Effect.timeoutOrElse({ duration: "3 seconds", orElse: () => Effect.succeed("timed-out" as const) }),
      Effect.exit,
    )
  if (Exit.isFailure(exit)) return "BLOCKED"
  if (exit.value === "timed-out") return "HANGS"
  return output.args.command === COMMAND ? "RUNS" : "RUNS_REWRITTEN"
})

describe("opencode tool.execute.before hook study", () => {
  for (const [id, body] of Object.entries(CASES)) {
    it.instance(id, () =>
      withPlugin(
        body,
        Effect.gen(function* () {
          results[id] = yield* beforeTool()
        }),
      ),
    )
  }

  afterAll(() => {
    expect(results["throws"]).toBe("BLOCKED") // the control must hold, or the harness is wrong
    fs.writeFileSync(out, JSON.stringify(results, null, 2) + "\n")
  })
})
