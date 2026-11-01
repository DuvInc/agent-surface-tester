// End to end with no network and no key: a fake MCP server and a fake model gateway on localhost.
// The "model" calls a safe tool, then tries to change an object it did not create, then writes
// its report. This proves the loop, the SSE parsing, the call limit and the ownership guard.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

function serve(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      let body = ""; for await (const chunk of req) body += chunk;
      handler(req, res, body ? JSON.parse(body) : {});
    }).listen(0, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
  });
}

const TOOLS = [
  { name: "list_things", description: "List things.", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } },
  { name: "rename_thing", description: "Rename a thing.", inputSchema: { type: "object", properties: { thing_id: { type: "string" } } }, annotations: { readOnlyHint: false } },
];

test("agent loop: tool call, guard refusal, final report, cost", async () => {
  const seenByMcp = [];
  const mcp = await serve((req, res, msg) => {
    if (msg.method === "notifications/initialized") { res.writeHead(202).end(); return; }
    const reply = (result) => {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: msg.id, result })}\n\n`);
    };
    if (msg.method === "initialize") return reply({ protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "fake", version: "1" } });
    if (msg.method === "tools/list") return reply({ tools: TOOLS });
    seenByMcp.push(msg.params.name);
    return reply({ content: [{ type: "text", text: JSON.stringify({ data: [{ id: "thg_abcdefgh2345" }] }) }] });
  });

  let turn = 0;
  const gateway = await serve((req, res) => {
    const script = [
      { tool_calls: [{ id: "c1", type: "function", function: { name: "list_things", arguments: "{}" } }] },
      { tool_calls: [{ id: "c2", type: "function", function: { name: "rename_thing", arguments: '{"thing_id":"thg_abcdefgh2345"}' } }] },
      { content: "## Score\n7/10. The rename was refused by the harness." },
    ][turn++];
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { role: "assistant", ...script }, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 10, cost: 0.001 } }));
  });

  process.env.OPENROUTER_API_KEY = "test";
  process.env.OPENROUTER_BASE_URL = gateway.url;
  const { McpClient } = await import("../lib/mcp-client.mjs");
  const { runAgent } = await import("../lib/agent.mjs");
  const client = new McpClient({ url: mcp.url });
  await client.connect();
  const tools = await client.listTools();
  const result = await runAgent({ client, tools, target: { name: "fake" }, mission: "Test it.", model: "fake/model" });

  assert.deepEqual(seenByMcp, ["list_things"], "the guard must stop the rename before it reaches the server");
  assert.equal(result.trace[1].harnessRefusal, true);
  assert.match(result.finalReport, /7\/10/);
  assert.equal(result.totals.cost, 0.003);
  assert.equal(result.stoppedBy, "finished");
  mcp.server.close(); gateway.server.close();
});
