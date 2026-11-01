// The agent loop: model <-> MCP tools, with hard caps on steps, money and per-tool calls.
import { chat } from "./openrouter.mjs";
import { OwnershipGuard } from "./ownership.mjs";

const REPORT_FORMAT = `
When you have finished, write your final report in Markdown with exactly these sections:

## Score
One number out of 10 for the experience of using this server as an agent today, and one sentence why.

## What worked well
## Friction
For each point: what you did, what happened, what you expected, a concrete suggestion, and a severity (blocker, annoying, nit).
## Missing or surprising behaviour
## Tool coverage
A table of the tools you actually tried: tool name | verdict (clear / unclear / broken) | note. Then one line listing the tools you did not try.
## Unclear descriptions or parameters
## What would make it a 10/10

Be specific and honest. Quote tool names, parameters and error messages. Do not flatter.`;

export function systemPrompt({ target, extraRules = [] }) {
  const rules = [...(target.rules ?? []), ...extraRules];
  return [
    "You are an AI assistant. You can call tools provided by an MCP server.",
    target.context ? `About the server: ${target.context}` : "",
    rules.length ? `Rules for this session:\n${rules.map((r) => `- ${r}`).join("\n")}` : "",
    "Notes about the test setup: a harness sits between you and the server. It may cut very long tool outputs (a note says so) and may refuse a tool after a call limit (an error says so). Neither is a defect of the server: do not report them.",
    REPORT_FORMAT,
  ].filter(Boolean).join("\n\n");
}

function toOpenAiTool(tool) {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: [tool.description, tool.annotations ? `[annotations: ${JSON.stringify(tool.annotations)}]` : ""].filter(Boolean).join("\n"),
      parameters: tool.inputSchema ?? { type: "object", properties: {} },
    },
  };
}

function resultToText(result) {
  const text = (result.content ?? [])
    .map((part) => (part.type === "text" ? part.text : `[${part.type} content]`))
    .join("\n");
  return result.structuredContent && !text ? JSON.stringify(result.structuredContent) : text;
}

export async function runAgent({
  client, tools, target, mission, model, flex, reasoning,
  maxSteps = 40, maxCostUsd = 0.05, maxResultChars = 8000, log = () => {},
}) {
  const callCounts = {};
  const guard = target.onlyTouchOwn === false ? null : new OwnershipGuard({ alsoRecord: target.ownership?.alsoRecord });
  const messages = [
    { role: "system", content: systemPrompt({ target }) },
    { role: "user", content: mission },
  ];
  const trace = [];
  const totals = { cost: 0, promptTokens: 0, completionTokens: 0, steps: 0, toolCalls: 0, tiers: new Set() };
  const openAiTools = tools.map(toOpenAiTool);
  let finalReport = "";
  let stoppedBy = "finished";

  const step = async (withTools) => {
    const { message, usage, cost, tier, finishReason } = await chat(
      {
        model,
        messages,
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
    return { message, finishReason };
  };

  for (let i = 0; i < maxSteps; i++) {
    if (totals.cost >= maxCostUsd) { stoppedBy = "budget"; break; }
    let message;
    try { ({ message } = await step(true)); } catch (error) { stoppedBy = `model error: ${error.message}`; break; }
    const calls = message.tool_calls ?? [];
    if (!calls.length) { finalReport = message.content ?? ""; break; }
    for (const call of calls) {
      const name = call.function.name;
      let args = {};
      let parseError;
      try { args = call.function.arguments ? JSON.parse(call.function.arguments) : {}; } catch (e) { parseError = e.message; }
      const started = Date.now();
      let text, isError = false, harnessRefusal = false;
      const limit = target.limits?.[name];
      callCounts[name] = (callCounts[name] ?? 0) + 1;
      totals.toolCalls++;
      if (parseError) {
        text = `Invalid JSON arguments: ${parseError}`; isError = true; harnessRefusal = true;
      } else if (limit !== undefined && callCounts[name] > limit) {
        text = `Harness limit: ${name} may be called at most ${limit} times in this session.`; isError = true; harnessRefusal = true;
      } else if (!tools.some((t) => t.name === name)) {
        text = `Unknown tool ${name}`; isError = true;
      } else if (guard && (text = guard.check(tools.find((t) => t.name === name), args))) {
        isError = true; harnessRefusal = true;
      } else {
        try {
          const result = await client.callTool(name, args);
          isError = Boolean(result.isError);
          text = resultToText(result);
          if (!isError) guard?.record(name, text);
        } catch (error) {
          isError = true; text = `Protocol error: ${error.message}`;
        }
      }
      const full = text;
      if (text.length > maxResultChars) text = `${text.slice(0, maxResultChars)}\n[harness: output cut, ${full.length - maxResultChars} more characters]`;
      trace.push({ step: totals.steps, name, args, isError, harnessRefusal, ms: Date.now() - started, chars: full.length, result: full.slice(0, 20000) });
      log(`${isError ? "x" : "·"} ${name} ${JSON.stringify(args).slice(0, 110)}  (${Date.now() - started} ms)`);
      messages.push({ role: "tool", tool_call_id: call.id, content: text });
    }
  }

  if (!finalReport) {
    if (stoppedBy === "finished") stoppedBy = "steps";
    messages.push({ role: "user", content: "Time is up. Stop calling tools and write your final report now, in the format required, based on what you did so far." });
    try { finalReport = (await step(false)).message.content ?? ""; } catch (error) { finalReport = `(No report: the model failed. ${error.message})`; }
  }
  return { finalReport, trace, totals: { ...totals, tiers: [...totals.tiers] }, stoppedBy, callCounts };
}
