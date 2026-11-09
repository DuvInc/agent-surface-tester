import { test } from "node:test";
import assert from "node:assert/strict";
import { withCacheBreakpoints } from "../lib/cache.mjs";

const transcript = [
  { role: "system", content: "rules" },
  { role: "user", content: "mission" },
  { role: "assistant", content: null, tool_calls: [{ id: "1" }] },
  { role: "tool", tool_call_id: "1", content: "result" },
];

test("an Anthropic model gets a breakpoint on the system prompt and on the newest message", () => {
  const sent = withCacheBreakpoints("anthropic/claude-haiku-5.5", transcript);
  assert.deepEqual(sent[0].content, [{ type: "text", text: "rules", cache_control: { type: "ephemeral" } }]);
  assert.deepEqual(sent[3].content, [{ type: "text", text: "result", cache_control: { type: "ephemeral" } }]);
  assert.equal(sent[1].content, "mission");
  assert.equal(transcript[0].content, "rules", "the transcript itself stays plain");
});

test("other providers cache on their own and get the messages untouched", () => {
  assert.equal(withCacheBreakpoints("openai/gpt-6-luna", transcript), transcript);
});

test("an assistant turn with no text is left alone", () => {
  const sent = withCacheBreakpoints("anthropic/claude-haiku-5.5", transcript.slice(0, 3));
  assert.equal(sent[2].content, null);
});
