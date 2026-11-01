// End to end with no network and no key: a fake MCP server and a fake model gateway on localhost.
import test from "node:test";
import assert from "node:assert/strict";
import { serve, scriptedGateway, call } from "./helpers.mjs";
import { createMcpSurface } from "../lib/surfaces/mcp.mjs";
import { runAgent } from "../lib/agent.mjs";

const TOOLS = [
  { name: "list_things", description: "List things.", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } },
  { name: "rename_thing", description: "Rename a thing.", inputSchema: { type: "object", properties: { thing_id: { type: "string" } } }, annotations: { readOnlyHint: false } },
];

test("mcp: tool call, guard refusal, per-tool limit, final report, cost", async () => {
  const seen = [];
  const mcp = await serve((req, res, msg) => {
    if (msg.method === "notifications/initialized") { res.writeHead(202).end(); return; }
    const reply = (result) => {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: msg.id, result })}\n\n`);
    };
    if (msg.method === "initialize") return reply({ protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "fake", version: "1" } });
    if (msg.method === "tools/list") return reply({ tools: TOOLS });
    seen.push(msg.params.name);
    return reply({ content: [{ type: "text", text: JSON.stringify({ data: [{ id: "thg_abcdefgh2345" }] }) }] });
  });
  const gw = await scriptedGateway([
    call("c1", "list_things", {}),
    call("c2", "rename_thing", { thing_id: "thg_abcdefgh2345" }),
    call("c3", "list_things", {}),
    { content: "## Score\n7/10." },
  ]);
  const surface = await createMcpSurface({ name: "fake", url: mcp.url });
  const result = await runAgent({ surface, target: { limits: { list_things: 1 } }, mission: "Test the {{surface}}.", model: "fake/model" });

  assert.deepEqual(seen, ["list_things"], "the guard and the limit must stop the other calls before the server");
  assert.equal(result.trace[1].harnessRefusal, true);
  assert.match(result.trace[2].result, /at most 1 times/);
  assert.match(result.finalReport, /7\/10/);
  assert.equal(result.totals.cost, 0.004);
  assert.deepEqual(result.covered, ["list_things"]);
  assert.match(gw.requests[0].messages[1].content, /Test the MCP server\./, "{{surface}} is filled in");
  mcp.server.close(); gw.server.close();
});
