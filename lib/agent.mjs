// The agent loop: model <-> one surface (MCP tools, an HTTP API or a command line), with hard
// caps on steps, money and per-operation calls, and a guard on what the agent may change.
import { chat } from "./openrouter.mjs";

const reportFormat = (surface) => `
When you have finished, write your final report in Markdown with exactly these sections:

## Score
One number out of 10 for the experience of using this ${surface.label} as an agent today, and one sentence why.

## What worked well
## Friction
For each point: what you did, what happened, what you expected, a concrete suggestion, and a severity (blocker, annoying, nit).
## Missing or surprising behaviour
## Coverage
A table of the ${surface.coverageNoun}s you actually tried: ${surface.coverageNoun} | verdict (clear / unclear / broken) | note. Then one line listing the areas you did not try.
## Unclear descriptions, parameters or documentation
## What would make it a 10/10

Be specific and honest. Quote names, parameters and error messages. Do not flatter.`;

export function systemPrompt({ target, surface, extraRules = [] }) {
  const rules = [...(target.rules ?? []), ...extraRules];
  return [
    `You are an AI assistant. ${surface.blurb}`,
    target.context ? `About the product: ${target.context}` : "",
    rules.length ? `Rules for this session:\n${rules.map((r) => `- ${r}`).join("\n")}` : "",
    "Notes about the test setup: a harness sits between you and the product. It may cut very long outputs (a note says so) and may refuse a call after a limit or because it would change something you did not create (an error says so). Neither is a defect of the product: do not report them.",
    reportFormat(surface),
  ].filter(Boolean).join("\n\n");
}

const toOpenAiTool = (tool) => ({
  type: "function",
  function: {
    name: tool.name,
    description: [tool.description, tool.annotations ? `[annotations: ${JSON.stringify(tool.annotations)}]` : ""].filter(Boolean).join("\n"),
    parameters: tool.inputSchema ?? { type: "object", properties: {} },
  },
});

/** Per-operation limits. On MCP the key is the tool name; on HTTP and CLI it is a regex over "METHOD /path" or "sub command". */
function limitFor(surface, limits, key) {
  for (const [pattern, max] of Object.entries(limits ?? {})) {
    const hit = surface.kind === "mcp" ? key === pattern : new RegExp(pattern).test(key);
    if (hit) return { pattern, max };
  }
  return null;
}

export async function runAgent({
  surface, target, mission, model, flex, reasoning,
  maxSteps = 40, maxCostUsd = 0.05, maxResultChars = 8000, log = () => {},
}) {
  const counts = {};
  const messages = [
    { role: "system", content: systemPrompt({ target, surface }) },
    { role: "user", content: mission.replaceAll("{{surface}}", surface.label) },
  ];
  const trace = [];
  const totals = { cost: 0, promptTokens: 0, completionTokens: 0, steps: 0, toolCalls: 0, tiers: new Set() };
  const openAiTools = surface.tools.map(toOpenAiTool);
  let finalReport = "";
  let stoppedBy = "finished";

  const step = async (withTools) => {
    const { message, usage, cost, tier } = await chat(
      {
        model, messages,
        ...(withTools ? { tools: openAiTools, tool_choice: "auto" } : {}),
        ...(reasoning ? { reasoning: { effort: reasoning } } : {}),
        usage: { include: true },
      },
      { flex },
    );
    totals.steps++;
    totals.cost += cost;
    totals.promptTokens += usage.prompt_tokens ?? 0;
    totals.completionTokens += usage.completion_tokens ?? 0;
    totals.tiers.add(tier);
    messages.push(message);
    return message;
  };

  for (let i = 0; i < maxSteps; i++) {
    if (totals.cost >= maxCostUsd) { stoppedBy = "budget"; break; }
    let message;
    try { message = await step(true); } catch (error) { stoppedBy = `model error: ${error.message}`; break; }
    const calls = message.tool_calls ?? [];
    if (!calls.length) { finalReport = message.content ?? ""; break; }
    for (const call of calls) {
      const name = call.function.name;
      let args = {};
      let parseError;
      try { args = call.function.arguments ? JSON.parse(call.function.arguments) : {}; } catch (e) { parseError = e.message; }
      const started = Date.now();
      totals.toolCalls++;
      let result;
      let refusal = null;
      if (parseError) refusal = `Invalid JSON arguments: ${parseError}`;
      else if (!surface.tools.some((t) => t.name === name)) result = { text: `Unknown tool ${name}`, isError: true };
      else {
        const key = surface.limitKey(name, args);
        const limit = limitFor(surface, target.limits, key);
        if (limit) {
          counts[limit.pattern] = (counts[limit.pattern] ?? 0) + 1;
          if (counts[limit.pattern] > limit.max) refusal = `Harness limit: "${limit.pattern}" may be used at most ${limit.max} times in this session.`;
        }
        refusal ??= surface.check(name, args);
      }
      if (refusal) result = { text: refusal, isError: true };
      else if (!result) {
        result = await surface.call(name, args);
        if (!result.isError) surface.record(name, args, result.text);
      }
      const full = result.text;
      const text = full.length > maxResultChars ? `${full.slice(0, maxResultChars)}\n[harness: output cut, ${full.length - maxResultChars} more characters]` : full;
      trace.push({
        step: totals.steps, name, args, isError: result.isError, harnessRefusal: Boolean(refusal),
        coverage: refusal || result.noCoverage ? null : surface.coverageKey(name, args),
        ms: Date.now() - started, chars: full.length, result: full.slice(0, 20000),
      });
      log(`${result.isError ? "x" : "·"} ${name} ${JSON.stringify(args).slice(0, 110)}  (${Date.now() - started} ms)`);
      messages.push({ role: "tool", tool_call_id: call.id, content: text });
    }
  }

  if (!finalReport) {
    if (stoppedBy === "finished") stoppedBy = "steps";
    messages.push({ role: "user", content: "Time is up. Stop calling tools and write your final report now, in the format required, based on what you did so far." });
    try { finalReport = (await step(false)).content ?? ""; } catch (error) { finalReport = `(No report: the model failed. ${error.message})`; }
  }
  const covered = [...new Set(trace.map((t) => t.coverage).filter(Boolean))];
  return { finalReport, trace, totals: { ...totals, tiers: [...totals.tiers] }, stoppedBy, covered };
}
