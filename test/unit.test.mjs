import test from "node:test";
import assert from "node:assert/strict";
import { parseRpc } from "../lib/mcp-client.mjs";
import { OwnershipGuard } from "../lib/ownership.mjs";

test("parseRpc reads plain JSON and SSE", () => {
  assert.equal(parseRpc('{"jsonrpc":"2.0","id":3,"result":{"a":1}}', 3).result.a, 1);
  const sse = 'event: message\ndata: {"jsonrpc":"2.0","id":7,"result":{"ok":true}}\n\n';
  assert.equal(parseRpc(sse, 7).result.ok, true);
  assert.equal(parseRpc(sse, 8), null);
});

test("guard lets reads through and blocks changes to foreign ids", () => {
  const guard = new OwnershipGuard();
  const read = { name: "get_widget", annotations: { readOnlyHint: true } };
  const write = { name: "update_widget", annotations: { readOnlyHint: false } };
  assert.equal(guard.check(read, { widget_id: "wdg_5qd9thdejqfy" }), null);
  assert.match(guard.check(write, { widget_id: "wdg_5qd9thdejqfy" }), /did not create/);
  guard.record("create_widget", '{"id":"wdg_abcdefghjk23"}');
  assert.equal(guard.check(write, { widget_id: "wdg_abcdefghjk23", name: "x" }), null);
  assert.match(guard.check(write, { widget_id: "wdg_abcdefghjk23", other: ["res_zzzzzzzzzzzz"] }), /res_zzzzzzzzzzzz/);
});

test("guard ignores ids returned by read tools", () => {
  const guard = new OwnershipGuard();
  guard.record("list_resources", '{"data":[{"id":"res_aaaaaaaaaaaa"}]}');
  assert.match(guard.check({ name: "delete_resource" }, { resource_id: "res_aaaaaaaaaaaa" }), /did not create/);
});

test("guard owns the conversation an ask tool starts, not the citations it returns", () => {
  const guard = new OwnershipGuard({ alsoRecord: { ask_assistant: "^(cnv|msg)_" } });
  guard.record("ask_assistant", '{"conversation_id":"cnv_abcdefghjk23","citations":[{"resource_id":"res_aaaaaaaaaaaa"}]}');
  const ask = { name: "ask_assistant" };
  assert.equal(guard.check(ask, { conversation_id: "cnv_abcdefghjk23" }), null);
  assert.match(guard.check({ name: "delete_resource" }, { resource_id: "res_aaaaaaaaaaaa" }), /did not create/);
});

test("budget and step cutoffs identify the test harness so skipped cleanup is not blamed on the product", async () => {
  const { scriptedGateway, call } = await import("./helpers.mjs");
  const { runAgent } = await import("../lib/agent.mjs");

  const surface = {
    kind: "mcp",
    label: "MCP server",
    blurb: "Use MCP tools.",
    coverageNoun: "tool",
    tools: [{ name: "ping", description: "Ping", inputSchema: { type: "object", properties: {} } }],
    limitKey: (name) => name,
    check: () => null,
    call: async () => ({ text: '{"ok":true}', isError: false }),
    record: () => {},
    coverageKey: (name) => name,
  };

  // Budget cap: scriptedGateway charges 0.001 per turn, so maxCostUsd: 0.001 stops after turn 1.
  const budgetGw = await scriptedGateway([
    call("1", "ping", {}),
    { content: "## Score\n9/10." },
  ]);
  const budgetRun = await runAgent({
    surface,
    target: {},
    mission: "Test {{surface}}.",
    model: "fake/model",
    maxCostUsd: 0.001,
    maxSteps: 5,
  });
  assert.equal(budgetRun.stoppedBy, "budget");
  const budgetFinalMessages = budgetGw.requests.at(-1).messages;
  assert.match(budgetFinalMessages[0].content, /test budget or step cap/);
  assert.match(budgetFinalMessages.at(-1).content, /\[harness\] Session budget cap reached/);
  assert.match(budgetFinalMessages.at(-1).content, /do not report skipped cleanup/i);
  budgetGw.server.close();

  // Step cap: maxSteps: 1 stops after 1 tool-calling turn.
  const stepGw = await scriptedGateway([
    call("1", "ping", {}),
    { content: "## Score\n9/10." },
  ]);
  const stepRun = await runAgent({
    surface,
    target: {},
    mission: "Test {{surface}}.",
    model: "fake/model",
    maxCostUsd: 1,
    maxSteps: 1,
  });
  assert.equal(stepRun.stoppedBy, "steps");
  assert.match(stepGw.requests.at(-1).messages.at(-1).content, /\[harness\] Session step cap reached/);
  stepGw.server.close();
});
