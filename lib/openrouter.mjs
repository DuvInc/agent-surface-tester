// The only file that talks to the model provider: one chat-completions call to OpenRouter
// (or any OpenAI-compatible gateway through OPENROUTER_BASE_URL), with tools, an optional flex
// tier and the real cost. The key is read here, when called, never at import.

// OpenRouter by default; LLM_BASE_URL and LLM_API_KEY point it at any OpenAI-compatible gateway
// (a local server, another provider). Cost and the flex tier are OpenRouter features: elsewhere cost reads 0.
const baseUrl = () => process.env.LLM_BASE_URL || process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";

export function openRouterKey() {
  const key = process.env.LLM_API_KEY || process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("Set OPENROUTER_API_KEY (or LLM_API_KEY): copy .env.example to .env and run with node --env-file=.env");
  return key;
}

async function once(body, key, timeoutMs) {
  const response = await fetch(`${baseUrl()}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let json;
  try { json = JSON.parse(text); } catch {}
  if (!response.ok || json?.error) {
    const error = new Error(`OpenRouter ${response.status}: ${(json?.error?.message ?? text).slice(0, 300)}`);
    error.status = response.status;
    throw error;
  }
  return json;
}

/**
 * `flex` asks for the discounted tier first. Flex can answer with a capacity error, so a failed
 * flex call is retried once as a normal call. Free models (":free") never use flex.
 */
export async function chat(body, { flex = false, attempts = 5 } = {}) {
  const key = openRouterKey();
  const useFlex = flex && !body.model.endsWith(":free");
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const json = await once(useFlex && attempt === 0 ? { ...body, service_tier: "flex" } : body, key, 240_000);
      const message = json.choices?.[0]?.message;
      if (!message) throw new Error("OpenRouter returned no message");
      return {
        message,
        finishReason: json.choices[0].finish_reason,
        usage: json.usage ?? {},
        cost: Number(json.usage?.cost ?? 0),
        tier: json.service_tier ?? "default",
      };
    } catch (error) {
      lastError = error;
      const retryable = !error.status || error.status === 429 || error.status >= 500;
      if (!retryable && !(useFlex && attempt === 0)) throw error;
      // Free models answer 429 "free-models-per-min" when several runs share the key: wait it out.
      await new Promise((resolve) => setTimeout(resolve, (error.status === 429 ? 15_000 : 1500) * (attempt + 1)));
    }
  }
  throw lastError;
}
