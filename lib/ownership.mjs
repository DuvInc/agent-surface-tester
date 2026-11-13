// Harness guard: an agent may only change what it created itself in this session.
// A prompt rule ("only delete your own things") is not enough: a model renamed an existing widget
// during a test run. So the harness remembers every id returned by a creating tool and refuses any
// non-read-only call that names another id.

const DEFAULT_ID = /^[a-z]{2,5}_[a-z0-9]{8,}$/;
// Verb first (create_widget) or resource first (apps_create, records_add): both namings are common.
const CREATING = /^(create|add|duplicate|import|upload)_|_(create|add|duplicate|import|upload)$/;

export class OwnershipGuard {
  /**
   * `alsoRecord` maps a tool name to a regex: of the ids that tool returns, only the matching ones
   * become the agent's own (e.g. an ask tool starts a conversation but also returns citation ids
   * of resources the agent did not create).
   */
  /**
   * `owned` lists ids that are the agent's from the start: the workspace, organisation or suite it
   * was given. Without it, creating anything inside them ("apps_create { suiteId }") was refused,
   * because the container's id is not one the agent created (2026-11-09, grid82).
   */
  constructor({ idPattern = DEFAULT_ID, creating = CREATING, alsoRecord = {}, owned = [] } = {}) {
    // A target may narrow it: grid82's select options ("in_progress") look like ids, and a create
    // naming one was refused (2026-11-09). Narrower means some real ids go unguarded, so it is opt-in.
    this.idPattern = typeof idPattern === "string" ? new RegExp(idPattern) : idPattern;
    this.creating = typeof creating === "string" ? new RegExp(creating) : creating;
    this.alsoRecord = Object.fromEntries(Object.entries(alsoRecord).map(([k, v]) => [k, new RegExp(v)]));
    this.owned = new Set(owned);
  }

  #ids(value, out = []) {
    if (typeof value === "string") { if (this.idPattern.test(value)) out.push(value); }
    else if (Array.isArray(value)) value.forEach((v) => this.#ids(v, out));
    else if (value && typeof value === "object") Object.values(value).forEach((v) => this.#ids(v, out));
    return out;
  }

  /** Refusal for a surface without tool annotations (HTTP, CLI): `label` names the call, `args` holds its ids. */
  refuse(label, args, embeddedText = "") {
    // `embeddedText` is scanned for ids anywhere inside it (a URL path, a --flag=value), while
    // `args` only counts values that are an id on their own, so free text cannot trigger the guard.
    const inText = (embeddedText.match(/[a-z]{2,5}_[a-z0-9]{8,}/g) ?? []).filter((id) => this.idPattern.test(id));
    const foreign = [...this.#ids(args), ...inText].filter((id) => !this.owned.has(id));
    if (!foreign.length) return null;
    return `Harness guard: ${label} would change ${foreign.join(", ")}, which you did not create in this session. Only change what you created.`;
  }

  /** Remember ids found in `text` that match `only` (all ids when `only` is null). */
  recordIds(text, only = null) {
    const re = only ? new RegExp(only) : null;
    for (const id of text.match(/[a-z]{2,5}_[a-z0-9]{8,}/g) ?? []) if (this.idPattern.test(id) && (!re || re.test(id))) this.owned.add(id);
  }

  /** Returns a refusal message, or null if the call may go through. */
  check(tool, args) {
    if (tool.annotations?.readOnlyHint === true) return null;
    const foreign = this.#ids(args).filter((id) => !this.owned.has(id));
    if (!foreign.length) return null;
    return `Harness guard: ${tool.name} would change ${foreign.join(", ")}, which you did not create in this session. Only change what you created.`;
  }

  /** Remember the ids a creating tool returned (parsed from its JSON text, whatever the shape). */
  record(toolName, resultText) {
    const only = this.alsoRecord[toolName];
    if (!only && !this.creating.test(toolName)) return;
    const matches = resultText.match(/[a-z]{2,5}_[a-z0-9]{8,}/g) ?? [];
    for (const id of matches) if (this.idPattern.test(id) && (!only || only.test(id))) this.owned.add(id);
  }
}
