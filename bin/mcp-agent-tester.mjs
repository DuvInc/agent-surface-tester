#!/usr/bin/env node
// mcp-agent-tester run|tools|cleanup --target targets/your-server.json [...]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { basename } from "node:path";
import { McpClient } from "../lib/mcp-client.mjs";
import { runAgent } from "../lib/agent.mjs";

const USAGE = `Usage:
  mcp-agent-tester tools    --target <target.json>
  mcp-agent-tester run      --target <target.json> --mission <mission.md> [--model <id>] [--flex] [--reasoning low]
                            [--max-steps 40] [--max-cost 0.05] [--key-from-clipboard] [--out reports]
  mcp-agent-tester cleanup  --target <target.json> [--dry]`;

const [command, ...rest] = process.argv.slice(2);
const { values: o } = parseArgs({
  args: rest,
  options: {
    target: { type: "string" }, mission: { type: "string" },
    model: { type: "string", default: "openai/gpt-6-luna" },
    flex: { type: "boolean", default: false }, reasoning: { type: "string" },
    "max-steps": { type: "string", default: "40" }, "max-cost": { type: "string", default: "0.05" },
    "key-from-clipboard": { type: "boolean", default: false }, dry: { type: "boolean", default: false },
    out: { type: "string", default: "reports" },
  },
});
if (!["run", "tools", "cleanup"].includes(command) || !o.target) { console.error(USAGE); process.exit(1); }

const target = JSON.parse(readFileSync(o.target, "utf8"));

function clipboard() {
  const candidates = [["pbpaste", []], ["wl-paste", ["-n"]], ["xclip", ["-selection", "clipboard", "-o"]], ["powershell", ["-command", "Get-Clipboard"]]];
  for (const [cmd, args] of candidates) {
    try { return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch {}
  }
  throw new Error("No clipboard command found (pbpaste, wl-paste, xclip, powershell)");
}

/** Where the credential comes from: an environment variable, the clipboard, or nothing. Never printed. */
function authHeaders(auth = { type: "none" }) {
  if (auth.type === "none") return {};
  let token;
  if (o["key-from-clipboard"] || auth.type === "clipboard") token = clipboard();
  else if (auth.type === "bearer") {
    token = process.env[auth.env];
    if (!token) throw new Error(`The environment variable ${auth.env} is empty (set by "auth.env" in the target)`);
  } else throw new Error(`Unsupported auth type "${auth.type}". Use none, bearer or clipboard.`);
  return { [auth.header ?? "Authorization"]: `${auth.scheme ?? "Bearer"} ${token}`.trim() };
}

const client = new McpClient({ url: target.url, headers: authHeaders(target.auth) });
const init = await client.connect();
const tools = await client.listTools();
console.log(`Connected to ${init.serverInfo?.name ?? target.url} ${init.serverInfo?.version ?? ""}: ${tools.length} tools`);

if (command === "tools") {
  for (const t of tools) console.log(`- ${t.name}${t.annotations?.readOnlyHint ? "" : "  (changes something)"}`);
  process.exit(0);
}

if (command === "cleanup") {
  // Deletes what a run left behind: anything whose name starts with target.cleanup.prefix.
  const { prefix, steps } = target.cleanup ?? {};
  if (!prefix || !steps) { console.error('The target has no "cleanup" section'); process.exit(1); }
  for (const step of steps) {
    const listed = JSON.parse((await client.callTool(step.list, {})).content[0].text);
    const rows = Array.isArray(listed) ? listed : listed.data ?? Object.values(listed).find(Array.isArray) ?? [];
    for (const row of rows.filter((r) => String(r[step.nameField] ?? "").startsWith(prefix))) {
      if (o.dry) { console.log(`would call ${step.delete} on ${row.id} (${row[step.nameField]})`); continue; }
      const r = await client.callTool(step.delete, { [step.idArg]: row.id });
      console.log(`${r.isError ? "FAILED" : "deleted"} ${step.delete} ${row.id} (${row[step.nameField]})`);
    }
  }
  process.exit(0);
}

if (!o.mission) { console.error("--mission <file.md> is required"); process.exit(1); }
const mission = readFileSync(o.mission, "utf8");
const started = new Date();
const result = await runAgent({
  client, tools, target, mission, model: o.model, flex: o.flex, reasoning: o.reasoning,
  maxSteps: Number(o["max-steps"]), maxCostUsd: Number(o["max-cost"]), log: console.log,
});

const slug = `${started.toISOString().slice(0, 16).replace(/[:T]/g, "-")}_${basename(o.target, ".json")}_${basename(o.mission, ".md")}_${o.model.replace(/[^a-z0-9.]+/gi, "-")}`;
mkdirSync(o.out, { recursive: true });
writeFileSync(`${o.out}/${slug}.json`, JSON.stringify({ options: o, serverInfo: init.serverInfo, tools: tools.map((t) => t.name), ...result }, null, 2));
const rows = result.trace.map((t) => `| ${t.step} | \`${t.name}\` | ${t.harnessRefusal ? "harness" : t.isError ? "error" : "ok"} | ${t.ms} | ${t.chars} |`);
writeFileSync(`${o.out}/${slug}.md`, `# ${target.name ?? target.url}: ${o.model}

- Mission: \`${o.mission}\`  ·  Date: ${started.toISOString()}
- Stopped by: **${result.stoppedBy}**  ·  Steps: ${result.totals.steps}  ·  Tool calls: ${result.totals.toolCalls}
- Tokens: ${result.totals.promptTokens} in / ${result.totals.completionTokens} out  ·  Tier: ${result.totals.tiers.join(", ")}
- **Cost: $${result.totals.cost.toFixed(5)}**

> One agent's opinion. Input for a decision, not a directive: another model may say the opposite.

${result.finalReport}

## Tool call trace

| step | tool | outcome | ms | chars |
|---:|---|---|---:|---:|
${rows.join("\n")}
`);
console.log(`\nCost $${result.totals.cost.toFixed(5)}, ${result.totals.toolCalls} tool calls, stopped by ${result.stoppedBy}\nReport: ${o.out}/${slug}.md`);
