import http from "node:http";

export function serve(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      let body = ""; for await (const chunk of req) body += chunk;
      let json; try { json = body ? JSON.parse(body) : {}; } catch { json = {}; }
      handler(req, res, json, body);
    }).listen(0, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
  });
}

/** A model gateway that plays a script: each entry is the assistant message for one turn. */
export async function scriptedGateway(script) {
  const requests = [];
  let turn = 0;
  const gateway = await serve((req, res, body) => {
    requests.push(body);
    const message = script[turn++] ?? { content: "## Score\n5/10 (script ran out)" };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { role: "assistant", ...message }, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 10, cost: 0.001 } }));
  });
  process.env.OPENROUTER_API_KEY = "gateway-test-key";
  process.env.OPENROUTER_BASE_URL = gateway.url;
  return { ...gateway, requests };
}

export const call = (id, name, args) => ({ tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }] });
