// Minimal MCP client for the Streamable HTTP transport (JSON-RPC over POST).
// No dependency: the server may answer with JSON or with a Server-Sent Events stream.

export class McpClient {
  constructor({ url, headers = {}, clientInfo = { name: "mcp-agent-tester", version: "0.1.0" } }) {
    this.url = url;
    this.headers = headers;
    this.clientInfo = clientInfo;
    this.sessionId = null;
    this.nextId = 1;
  }

  async #post(message) {
    const response = await fetch(this.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...(this.sessionId ? { "Mcp-Session-Id": this.sessionId } : {}),
        ...this.headers,
      },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(120_000),
    });
    const sid = response.headers.get("mcp-session-id");
    if (sid) this.sessionId = sid;
    return { response, text: await response.text() };
  }

  async request(method, params = {}) {
    const id = this.nextId++;
    const { response, text } = await this.#post({ jsonrpc: "2.0", id, method, params });
    if (!response.ok && !text.trim().startsWith("{") && !text.includes("data:")) {
      throw new Error(`HTTP ${response.status} on ${method}: ${text.slice(0, 300)}`);
    }
    const message = parseRpc(text, id);
    if (!message) throw new Error(`No JSON-RPC answer to ${method} (HTTP ${response.status}): ${text.slice(0, 300)}`);
    if (message.error) {
      const error = new Error(`${method}: ${message.error.message}`);
      error.rpc = message.error;
      throw error;
    }
    return message.result;
  }

  async notify(method, params = {}) {
    await this.#post({ jsonrpc: "2.0", method, params });
  }

  async connect() {
    const result = await this.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: this.clientInfo,
    });
    await this.notify("notifications/initialized");
    return result;
  }

  async listTools() {
    const tools = [];
    let cursor;
    do {
      const page = await this.request("tools/list", cursor ? { cursor } : {});
      tools.push(...(page.tools ?? []));
      cursor = page.nextCursor;
    } while (cursor);
    return tools;
  }

  callTool(name, args) {
    return this.request("tools/call", { name, arguments: args ?? {} });
  }
}

/** Pull the JSON-RPC message for `id` out of a JSON body or an SSE stream. */
export function parseRpc(text, id) {
  const body = text.trim();
  if (body.startsWith("{") || body.startsWith("[")) {
    const parsed = JSON.parse(body);
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return list.find((m) => m.id === id) ?? list[0];
  }
  for (const event of body.split(/\r?\n\r?\n/)) {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) continue;
    try {
      const message = JSON.parse(data);
      if (message.id === id) return message;
    } catch {}
  }
  return null;
}
