// Surface "mcp": the tools of an MCP server, exactly as the server lists them.
import { McpClient } from "../mcp-client.mjs";
import { OwnershipGuard } from "../ownership.mjs";

function resultToText(result) {
  const text = (result.content ?? []).map((part) => (part.type === "text" ? part.text : `[${part.type} content]`)).join("\n");
  return result.structuredContent && !text ? JSON.stringify(result.structuredContent) : text;
}

export async function createMcpSurface(target, { headers = {} } = {}) {
  const client = new McpClient({ url: target.url, headers });
  const init = await client.connect();
  const tools = (await client.listTools()).map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations }));
  const guard = target.onlyTouchOwn === false ? null : new OwnershipGuard({ alsoRecord: target.ownership?.alsoRecord, creating: target.ownership?.creating, owned: target.ownership?.owned, ...(target.ownership?.idPattern ? { idPattern: target.ownership.idPattern } : {}) });
  return {
    kind: "mcp",
    label: "MCP server",
    info: init.serverInfo ?? {},
    tools,
    blurb: "You can call tools provided by an MCP server.",
    coverageNoun: "tool",
    client,
    limitKey: (name) => name,
    coverageKey: (name) => name,
    check: (name, args) => (guard ? guard.check(tools.find((t) => t.name === name) ?? { name }, args) : null),
    record: (name, args, text) => guard?.record(name, text),
    async call(name, args) {
      try {
        const result = await client.callTool(name, args);
        return { text: resultToText(result), isError: Boolean(result.isError) };
      } catch (error) {
        return { text: `Protocol error: ${error.message}`, isError: true };
      }
    },
    async close() {},
  };
}
