// Prompt caching for models that only cache when asked (Anthropic's, through OpenRouter).
//
// A run resends the same prefix on every step: the tool catalogue, the system prompt and every
// earlier call. Without a breakpoint an Anthropic model pays full price for all of it each time,
// so a 40-step MCP tour of a 125-tool server cost five to ten times what it does with one (2026-11-09).
// Two breakpoints: the system prompt (which caches the tools in front of it) and the newest
// message, which moves forward each step so the next one reads everything before it from cache.
// Other providers cache on their own and get the messages untouched.

const needsBreakpoints = (model) => /^(anthropic\/|~anthropic\/)/.test(model);

const marked = (message) => {
  if (typeof message.content !== "string" || message.content === "") return message;
  return { ...message, content: [{ type: "text", text: message.content, cache_control: { type: "ephemeral" } }] };
};

/** Returns the messages to send. Never changes the array it is given: the transcript stays plain text. */
export function withCacheBreakpoints(model, messages) {
  if (!needsBreakpoints(model) || messages.length === 0) return messages;
  const out = messages.slice();
  const system = out.findIndex((m) => m.role === "system");
  if (system !== -1) out[system] = marked(out[system]);
  const last = out.length - 1;
  if (last !== system) out[last] = marked(out[last]);
  return out;
}
