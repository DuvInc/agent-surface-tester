import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { scriptedGateway, call } from "./helpers.mjs";
import { createSdkSurface } from "../lib/surfaces/sdk.mjs";
import { runAgent } from "../lib/agent.mjs";

const rootDir = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));

test("sdk: isolated execution, path guards, limits, and ownership guard", async () => {
  const gw = await scriptedGateway([
    call("1", "read_docs", { url: "package.json" }),
    call("2", "read_docs", { url: "../../.env" }),
    call("3", "run_code", { code: 'console.log("created res_owned12345678"); // client.resources.create()' }),
    call("4", "run_code", { code: 'console.log("read foreign"); // client.resources.get("res_other99999999")' }),
    call("5", "run_code", { code: 'console.log("mutate owned"); // client.resources.update("res_owned12345678")' }),
    call("6", "run_code", { code: 'console.log("mutate foreign"); // client.resources.update("res_other99999999")' }),
    call("7", "run_code", { code: "const padding = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'; // client.ask('one'); console.log(padding.length);" }),
    call("8", "run_code", { code: "const padding = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'; // client.ask('two'); console.log(padding.length);" }),
    call("9", "write_file", { path: "data/input.txt", content: "testing 123" }),
    call("10", "read_file", { path: "data/input.txt" }),
    call("11", "write_file", { path: "../escape.txt", content: "blocked" }),
    { content: "## Score\n10/10." },
  ]);

  const target = {
    sdk: {
      package: "agent-surface-tester-dummy",
      path: rootDir,
      env: { CUSTOM_TEST_VAR: "active" },
      credentialEnv: "SDK_KEY",
    },
    limits: {
      "client\\.ask": 1,
    },
    ownership: {
      rules: [{ match: "resources\\.create", ids: "^res_" }],
    },
  };

  const surface = createSdkSurface(target, { credential: "secret-token" });
  const result = await runAgent({
    surface,
    target,
    mission: "Test the {{surface}}.",
    model: "fake/model",
  });

  const t = result.trace;
  assert.match(t[0].result, /"name": "agent-surface-tester"/);
  assert.match(t[1].result, /Path outside the SDK package directory/);
  assert.equal(t[1].isError, true);

  assert.match(t[2].result, /res_owned12345678/);
  assert.equal(t[3].isError, false);
  assert.equal(t[4].isError, false);
  assert.equal(t[5].harnessRefusal, true);
  assert.match(t[5].result, /Harness guard: run_code would change res_other99999999/);

  assert.equal(t[6].isError, false);
  assert.equal(t[7].harnessRefusal, true);
  assert.match(t[7].result, /Harness limit: "client\\\.ask" may be used at most 1 times/);

  assert.equal(t[9].result, "testing 123");
  assert.match(t[10].result, /Path outside the working directory/);

  await surface.close();
  gw.server.close();
});
