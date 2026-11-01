#!/usr/bin/env node
// mcp-agent-tester tools|run|cleanup|suite ...   (see USAGE)
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { parseArgs } from "node:util";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { McpClient } from "../lib/mcp-client.mjs";
import { runAgent } from "../lib/agent.mjs";
import { createSurface } from "../lib/surfaces/index.mjs";
import { acquireLock, lockKey } from "../lib/lock.mjs";

const USAGE = `Usage:
  mcp-agent-tester tools    --target <target.json>
  mcp-agent-tester run      --target <target.json> --mission <mission.md> [--model <id>] [--flex] [--reasoning low]
                            [--max-steps 40] [--max-cost 0.05] [--key-from-clipboard] [--wait-lock <seconds>] [--out reports]
  mcp-agent-tester cleanup  --target <target.json> [--dry]
  mcp-agent-tester suite    --suite <suite.json> [--out reports]

A target has a "surface": "mcp" (default), "api" or "cli". One agent per surface per run, one run at a time per workspace.`;

const [command, ...rest] = process.argv.slice(2);
const { values: o } = parseArgs({
  args: rest,
  options: {
    target: { type: "string" }, mission: { type: "string" }, suite: { type: "string" },
    model: { type: "string", default: "openai/gpt-6-luna" },
    flex: { type: "boolean", default: false }, reasoning: { type: "string" },
    "max-steps": { type: "string", default: "40" }, "max-cost": { type: "string", default: "0.05" },
    "key-from-clipboard": { type: "boolean", default: false }, dry: { type: "boolean", default: false },
    "wait-lock": { type: "string", default: "0" }, out: { type: "string", default: "reports" },
  },
});
if (!["run", "tools", "cleanup", "suite"].includes(command)) { console.error(USAGE); process.exit(1); }

function clipboard() {
  const candidates = [["pbpaste", []], ["wl-paste", ["-n"]], ["xclip", ["-selection", "clipboard", "-o"]], ["powershell", ["-command", "Get-Clipboard"]]];
  for (const [cmd, args] of candidates) {
    try { return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch {}
  }
  throw new Error("No clipboard command found (pbpaste, wl-paste, xclip, powershell)");
}

/** The credential comes from an environment variable, the clipboard, or nowhere. It is never printed. */
function credentialOf(auth = { type: "none" }) {
  if (auth.type === "none") return null;
  if (o["key-from-clipboard"] || auth.type === "clipboard") return clipboard();
  if (auth.type === "bearer") {
    const token = process.env[auth.env];
    if (!token) throw new Error(`The environment variable ${auth.env} is empty (set by "auth.env" in the target)`);
    return token;
  }
  throw new Error(`Unsupported auth type "${auth.type}". Use none, bearer or clipboard.`);
}
const headersOf = (auth = {}, token) => (token ? { [auth.header ?? "Authorization"]: `${auth.scheme ?? "Bearer"} ${token}`.trim() } : {});

if (command === "suite") {
  // Runs listed in a file, in parallel across workspaces. Two runs with the same credential
  // wait for each other's lock, so a suite can never put two agents in one workspace.
  const suite = JSON.parse(readFileSync(o.suite, "utf8"));
  const here = fileURLToPath(import.meta.url);
  const base = dirname(resolve(o.suite));
  const queue = suite.runs.map((r, i) => ({ ...r, id: i + 1 }));
  const results = [];
  const worker = async () => {
    for (let run = queue.shift(); run; run = queue.shift()) {
      const args = [here, "run", "--target", resolve(base, run.target), "--mission", resolve(base, run.mission), "--model", run.model ?? "openai/gpt-6-luna",
        "--max-cost", String(run.maxCost ?? 0.05), "--max-steps", String(run.maxSteps ?? 40), "--wait-lock", "1800", "--out", o.out];
      if (run.flex) args.push("--flex");
      if (run.reasoning) args.push("--reasoning", run.reasoning);
      const label = `#${run.id} ${basename(run.target, ".json")}/${basename(run.mission, ".md")}/${run.model}`;
      console.log(`start ${label}`);
      const output = await new Promise((done) => {
        let text = "";
        const child = spawn(process.execPath, args, { env: process.env });
        child.stdout.on("data", (d) => (text += d));
        child.stderr.on("data", (d) => (text += d));
        child.on("close", (code) => done({ code, text }));
      });
      const cost = /Cost \$([\d.]+), (\d+) tool calls, stopped by (.+)/.exec(output.text);
      const report = /Report: (.+)/.exec(output.text);
      results.push({ label, ok: output.code === 0, cost: cost?.[1], calls: cost?.[2], stopped: cost?.[3], report: report?.[1], error: output.code === 0 ? null : output.text.trim().split("\n").pop() });
      console.log(`done  ${label}: ${output.code === 0 ? `$${cost?.[1]}, ${cost?.[2]} calls, ${cost?.[3]}` : `FAILED ${results.at(-1).error}`}`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(suite.parallel ?? 3, queue.length) }, worker));
  const total = results.reduce((sum, r) => sum + Number(r.cost ?? 0), 0);
  console.log(`\n${results.length} runs, ${results.filter((r) => !r.ok).length} failed, total cost $${total.toFixed(5)}`);
  for (const r of results) console.log(`- ${r.label}: ${r.report ?? r.error}`);
  process.exit(0);
}

if (!o.target) { console.error(USAGE); process.exit(1); }
// {{targetDir}} in a target file is the folder holding it: paths that travel with the repo.
const target = JSON.parse(readFileSync(o.target, "utf8").replaceAll("{{targetDir}}", dirname(resolve(o.target))));
const token = credentialOf(target.auth);
const headers = headersOf(target.auth, token);

if (command === "tools") {
  const surface = await createSurface(target, { headers, credential: token });
  console.log(`${surface.label}: ${surface.info.name ?? target.name} ${surface.info.version ?? ""}, ${surface.tools.length} tools`);
  for (const t of surface.tools) console.log(`- ${t.name}${t.annotations && t.annotations.readOnlyHint !== true ? "  (changes something)" : ""}`);
  await surface.close();
  process.exit(0);
}

const release = await acquireLock(lockKey(token), { waitSeconds: Number(o["wait-lock"]), label: `${basename(o.target)} ${o.mission ? basename(o.mission) : command}` });

if (command === "cleanup") {
  // Deletes what a run left behind: anything whose name starts with target.cleanup.prefix.
  // Goes through an MCP endpoint (target.cleanup.url, or the target's own URL on an MCP target)
  // with the same credential, so it works whichever surface the run used.
  const { prefix, steps, url } = target.cleanup ?? {};
  if (!prefix || !steps || !(url ?? target.url)) { console.error('The target needs a "cleanup" section (prefix, steps, and url unless it is an MCP target)'); process.exit(1); }
  const client = new McpClient({ url: url ?? target.url, headers });
  await client.connect();
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
const surface = await createSurface(target, { headers, credential: token });
console.log(`${surface.label}: ${surface.info.name ?? target.name} ${surface.info.version ?? ""}, ${surface.tools.length} tools`);
const mission = readFileSync(o.mission, "utf8");
const started = new Date();
let result;
try {
  result = await runAgent({
    surface, target, mission, model: o.model, flex: o.flex, reasoning: o.reasoning,
    maxSteps: Number(o["max-steps"]), maxCostUsd: Number(o["max-cost"]), log: console.log,
  });
} finally { await surface.close(); release(); }

const slug = `${started.toISOString().slice(0, 19).replace(/[:T]/g, "-")}_${surface.kind}_${basename(o.mission, ".md")}_${o.model.replace(/[^a-z0-9.]+/gi, "-")}`;
mkdirSync(o.out, { recursive: true });
writeFileSync(`${o.out}/${slug}.json`, JSON.stringify({ options: o, surface: surface.kind, info: surface.info, tools: surface.tools.map((t) => t.name), ...result }, null, 2));
const rows = result.trace.map((t) => `| ${t.step} | \`${t.name}\` | ${t.coverage ?? ""} | ${t.harnessRefusal ? "harness" : t.isError ? "error" : "ok"} | ${t.ms} | ${t.chars} |`);
const coverageLine = surface.kind === "mcp"
  ? `${result.covered.length} of ${surface.tools.length} tools used`
  : `${result.covered.length} distinct ${surface.coverageNoun}s used`;
writeFileSync(`${o.out}/${slug}.md`, `# ${target.name ?? target.url ?? "target"} (${surface.label}): ${o.model}

- Mission: \`${o.mission}\`  ·  Date: ${started.toISOString()}
- Stopped by: **${result.stoppedBy}**  ·  Steps: ${result.totals.steps}  ·  Tool calls: ${result.totals.toolCalls}  ·  Measured coverage: ${coverageLine}
- Tokens: ${result.totals.promptTokens} in / ${result.totals.completionTokens} out  ·  Tier: ${result.totals.tiers.join(", ")}
- **Cost: $${result.totals.cost.toFixed(5)}**

> One agent's opinion. Input for a decision, not a directive: another model may say the opposite.

${result.finalReport}

## Call trace

| step | tool | ${surface.coverageNoun} | outcome | ms | chars |
|---:|---|---|---|---:|---:|
${rows.join("\n")}
`);
console.log(`\nCost $${result.totals.cost.toFixed(5)}, ${result.totals.toolCalls} tool calls, stopped by ${result.stoppedBy}\nReport: ${o.out}/${slug}.md`);
