import { createMcpSurface } from "./mcp.mjs";
import { createApiSurface } from "./api.mjs";
import { createCliSurface } from "./cli.mjs";

/** `credential` is the raw token; `headers` is the same token as the header the target asked for. */
export async function createSurface(target, { headers = {}, credential } = {}) {
  const kind = target.surface ?? "mcp";
  if (kind === "mcp") return createMcpSurface(target, { headers });
  if (kind === "api") return createApiSurface(target, { headers });
  if (kind === "cli") return createCliSurface(target, { credential });
  throw new Error(`Unknown surface "${kind}". Use mcp, api or cli.`);
}
