import test from "node:test";
import assert from "node:assert/strict";
import { serve, scriptedGateway, call } from "./helpers.mjs";
import { createApiSurface } from "../lib/surfaces/api.mjs";
import { runAgent } from "../lib/agent.mjs";

test("api: docs are read in windows, the credential stays out of the model, ownership holds", async () => {
  const hits = [];
  const api = await serve((req, res, body) => {
    hits.push({ method: req.method, url: req.url, auth: req.headers.authorization });
    res.writeHead(200, { "Content-Type": "application/json" });
    if (req.method === "POST" && req.url === "/v1/things") return res.end(JSON.stringify({ id: "thg_abcdefgh2345" }));
    if (req.url === "/docs/llms.txt") return res.end("D".repeat(20000));
    res.end(JSON.stringify({ ok: true }));
  });
  const host = new URL(api.url).hostname;
  const gw = await scriptedGateway([
    call("1", "read_docs", { url: `${api.url}/docs/llms.txt` }),
    call("2", "read_docs", { url: "https://evil.example/x" }),
    call("3", "http_request", { method: "POST", path: "/v1/things", body: { name: "mcp-test-a" } }),
    call("4", "http_request", { method: "PATCH", path: "/v1/things/thg_zzzzzzzzzzzz", body: { name: "x" } }),
    call("5", "http_request", { method: "PATCH", path: "/v1/things/thg_abcdefgh2345", body: { name: "y" } }),
    call("6", "http_request", { method: "GET", path: "//evil.example/v1" }),
    call("7", "http_request", { method: "POST", path: "/v1/things", body: JSON.stringify({ name: "mcp-test-b" }) }),
    { content: "## Score\n8/10." },
  ]);
  const surface = createApiSurface(
    { api: { baseUrl: `${api.url}/`, docsHosts: [host], docs: [`${api.url}/docs/llms.txt`] }, ownership: { rules: [{ match: "^POST /v1/things$" }] } },
    { headers: { Authorization: "Bearer api-secret" } },
  );
  const result = await runAgent({ surface, target: {}, mission: "Test the {{surface}}.", model: "fake/model" });

  assert.match(result.trace[0].result, /next_offset: 12000/);
  assert.match(result.trace[1].result, /not allowed/);
  assert.equal(result.trace[3].harnessRefusal, true, "a thing the agent did not create is refused");
  assert.equal(result.trace[4].isError, false, "a thing it created is allowed");
  assert.match(result.trace[5].result, /single \//);
  assert.equal(hits.filter((h) => h.method === "POST").length, 2, "a body given as a JSON string still reaches the server");
  const patches = hits.filter((h) => h.method === "PATCH");
  assert.deepEqual(patches.map((h) => h.url), ["/v1/things/thg_abcdefgh2345"]);
  assert.equal(patches[0].auth, "Bearer api-secret", "the harness adds the credential");
  assert.ok(!JSON.stringify(gw.requests).includes("api-secret"), "the model never sees the credential");
  assert.deepEqual(result.covered, ["POST /v1/things", "PATCH /v1/things/{id}"], "malformed calls and refusals are not coverage");
  api.server.close(); gw.server.close();
});
