// Surface "api": a REST API through one HTTP tool, plus a way to read its documentation.
// The agent never sees the credential and cannot leave the base URL: the harness builds the URL
// and adds the header. Documentation (OpenAPI, llms.txt, Markdown pages) is read with read_docs,
// GET only, on hosts the target lists. A real agent has to find its way in the documentation; so
// does this one.
import { OwnershipGuard } from "../ownership.mjs";

const WINDOW = 12_000;

export function createApiSurface(target, { headers = {} } = {}) {
  const api = target.api;
  if (!api?.baseUrl) throw new Error('A target with surface "api" needs api.baseUrl');
  const base = api.baseUrl.replace(/\/+$/, "");
  const docHosts = new Set((api.docsHosts ?? []).map((h) => h.toLowerCase()));
  const guard = target.onlyTouchOwn === false ? null : new OwnershipGuard();
  const rules = (target.ownership?.rules ?? []).map((r) => ({ match: new RegExp(r.match), ids: r.ids ?? null }));
  const key = (args) => `${String(args.method ?? "GET").toUpperCase()} ${String(args.path ?? "")}`;

  const tools = [
    {
      name: "http_request",
      description: `Call the REST API at ${base}. Give the method and a path that starts with "/" (for example "/v1/account"); the base URL and authentication are added for you. Query parameters go in \`query\`, a JSON body in \`body\`. The result starts with the HTTP status line.`,
      inputSchema: {
        type: "object",
        properties: {
          method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"] },
          path: { type: "string", description: "Path on the API, starting with /" },
          query: { type: "object", description: "Query string parameters", additionalProperties: true },
          body: { type: ["object", "array"], description: "JSON request body, as an object (not a string)" },
          idempotency_key: { type: "string", description: "Sent as the Idempotency-Key header" },
        },
        required: ["method", "path"],
      },
    },
    {
      name: "read_docs",
      description: `Read a documentation page or file with a GET request (allowed hosts: ${[...docHosts].join(", ") || "none"}). A long page comes in windows of ${WINDOW} characters: continue with \`offset\` set to the next_offset the result gives.`,
      inputSchema: {
        type: "object",
        properties: { url: { type: "string" }, offset: { type: "integer", minimum: 0 } },
        required: ["url"],
      },
    },
  ];

  const httpRequest = async (args) => {
    const method = String(args.method ?? "").toUpperCase();
    const path = String(args.path ?? "");
    if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) return { text: `Unsupported method ${method}`, isError: true, noCoverage: true };
    if (!path.startsWith("/") || path.includes("://") || path.includes("..") || path.startsWith("//")) {
      return { text: "The path must start with a single / and stay on the API.", isError: true, noCoverage: true };
    }
    // Some models pass the body as a JSON string. Sending that string as JSON gives "expected object,
    // received string" and the model blames the API (a free model did, and called it a blocker).
    if (typeof args.body === "string") {
      try { const parsed = JSON.parse(args.body); if (parsed && typeof parsed === "object") args = { ...args, body: parsed }; } catch {}
    }
    const url = new URL(base + path);
    for (const [k, v] of Object.entries(args.query ?? {})) url.searchParams.set(k, String(v));
    const started = Date.now();
    const response = await fetch(url, {
      method,
      headers: {
        Accept: "application/json",
        ...(args.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(args.idempotency_key ? { "Idempotency-Key": String(args.idempotency_key) } : {}),
        ...headers,
      },
      body: args.body !== undefined && method !== "GET" ? JSON.stringify(args.body) : undefined,
      signal: AbortSignal.timeout(60_000),
    });
    const body = await response.text();
    return {
      text: `HTTP ${response.status} ${response.statusText} (${Date.now() - started} ms)\n${body}`,
      isError: response.status >= 400,
    };
  };

  const readDocs = async (args) => {
    let url;
    try { url = new URL(String(args.url)); } catch { return { text: "Not a valid URL", isError: true }; }
    if (url.protocol !== "https:" && url.protocol !== "http:") return { text: "Only http(s) URLs", isError: true };
    if (!docHosts.has(url.hostname.toLowerCase())) return { text: `Host ${url.hostname} is not allowed. Allowed: ${[...docHosts].join(", ")}`, isError: true };
    const response = await fetch(url, { headers: { Accept: "text/markdown, text/plain, application/json, */*" }, signal: AbortSignal.timeout(60_000) });
    const text = await response.text();
    const offset = Math.max(0, Number(args.offset ?? 0));
    const part = text.slice(offset, offset + WINDOW);
    const next = offset + WINDOW < text.length ? ` next_offset: ${offset + WINDOW}` : " end of document";
    return { text: `HTTP ${response.status}, ${text.length} characters, showing ${offset}-${offset + part.length},${next}\n${part}`, isError: response.status >= 400 };
  };

  return {
    kind: "api",
    label: "REST API",
    info: { name: target.name ?? base },
    tools,
    blurb: `You can call a REST API with the http_request tool (base URL ${base}, authentication added for you).${api.docs?.length ? ` Documentation to start from: ${api.docs.join(", ")}. Read it with read_docs.` : ""}`,
    coverageNoun: "operation",
    limitKey: (name, args) => (name === "http_request" ? key(args) : name),
    // /v1/resources/res_abc123def456 and /v1/resources/res_xyz... count as one operation.
    coverageKey: (name, args) => (name === "http_request" ? key(args).replace(/[a-z]{2,5}_[a-z0-9]{8,}/g, "{id}") : null),
    check(name, args) {
      if (!guard || name !== "http_request" || String(args.method ?? "GET").toUpperCase() === "GET") return null;
      return guard.refuse(key(args), { query: args.query, body: args.body }, args.path);
    },
    record(name, args, text) {
      if (name !== "http_request") return;
      for (const rule of rules) if (rule.match.test(key(args))) guard?.recordIds(text, rule.ids);
    },
    async call(name, args) {
      try {
        if (name === "http_request") return await httpRequest(args);
        if (name === "read_docs") return await readDocs(args);
        return { text: `Unknown tool ${name}`, isError: true };
      } catch (error) {
        return { text: `Request failed: ${error.message}`, isError: true };
      }
    },
    async close() {},
  };
}
