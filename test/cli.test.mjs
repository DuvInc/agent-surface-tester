import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { scriptedGateway, call } from "./helpers.mjs";
import { createCliSurface } from "../lib/surfaces/cli.mjs";
import { runAgent } from "../lib/agent.mjs";

const FAKE = fileURLToPath(new URL("./fixtures/fake-cli.mjs", import.meta.url));

test("cli: no shell, scrubbed environment, scratch directory, ownership, denied subcommand", async () => {
  process.env.SHOULD_NOT_LEAK = "parent-secret";
  const gw = await scriptedGateway([
    call("1", "run_cli", { args: ["--help"] }),
    call("2", "run_cli", { args: ["env"] }),
    call("3", "run_cli", { args: ["things", "rename", "thg_zzzzzzzzzzzz"] }),
    call("4", "run_cli", { args: ["things", "create"] }),
    call("5", "run_cli", { args: ["things", "rename", "thg_abcdefgh2345"] }),
    call("6", "run_cli", { args: ["--help; echo pwned"] }),
    call("7", "run_cli", { args: ["dangerous", "x"] }),
    call("8", "write_file", { path: "../escape.txt", content: "x" }),
    call("9", "write_file", { path: "ok/note.txt", content: "hello" }),
    call("10", "read_file", { path: "ok/note.txt" }),
    { content: "## Score\n9/10." },
  ]);
  const surface = createCliSurface(
    { cli: { command: ["node", FAKE], name: "fake-cli", credentialEnv: "FAKE_KEY", deny: ["dangerous"] }, ownership: { rules: [{ match: "^things create" }] } },
    { credential: "cli-secret" },
  );
  const result = await runAgent({ surface, target: {}, mission: "Test the {{surface}}.", model: "fake/model" });
  const t = result.trace;

  assert.match(t[0].result, /fake-cli: things create/);
  const env = JSON.parse(t[1].result.split("\n")[0]);
  assert.deepEqual(env, { key: "set", leaked: null, homeIsScratch: true, cwdIsScratch: true });
  assert.equal(t[2].harnessRefusal, true, "renaming something not created is refused");
  assert.match(t[4].result, /thg_abcdefgh2345/, "renaming its own is allowed");
  assert.match(t[5].result, /unknown command/, "no shell: the semicolon is just an argument");
  assert.match(t[6].result, /not available/);
  assert.match(t[7].result, /outside the working directory/);
  assert.equal(t[9].result, "hello");
  assert.ok(!JSON.stringify(gw.requests).includes("cli-secret"));
  await surface.close();
  gw.server.close();
});
