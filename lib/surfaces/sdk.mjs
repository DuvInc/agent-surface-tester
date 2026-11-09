// Surface "sdk": a client SDK package, run in a fresh scratch directory.
// The agent writes short Node.js ESM scripts that import the package. The credential is injected
// into the child environment variable the SDK reads; the package directory is symlinked into the
// scratch folder's node_modules so `import { ... } from '<package>'` works without npm install.
import { execFile } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, symlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { OwnershipGuard } from "../ownership.mjs";

const OUTPUT_CAP = 1_000_000;
const WINDOW = 12_000;
const MUTATING_DEFAULT = "\\b(update|delete|remove|destroy|rename|pause|revoke|patch|put)\\w*\\s*\\(";

export function createSdkSurface(target, { credential } = {}) {
  const sdk = target.sdk;
  if (!sdk?.path) throw new Error('A target with surface "sdk" needs sdk.path (path to the package directory)');
  const resolvedPkgPath = resolve(sdk.path);
  if (!existsSync(resolvedPkgPath)) throw new Error(`sdk.path does not exist: ${resolvedPkgPath}`);

  const pkgName = sdk.package ?? "sdk";
  const scratch = mkdtempSync(join(tmpdir(), "agent-surface-tester-sdk-"));
  const modulesDir = join(scratch, "node_modules");
  const pkgTargetDir = join(modulesDir, ...pkgName.split("/"));
  mkdirSync(dirname(pkgTargetDir), { recursive: true });
  symlinkSync(resolvedPkgPath, pkgTargetDir, "dir");

  writeFileSync(
    join(scratch, "package.json"),
    JSON.stringify({ name: "agent-sdk-scratch", type: "module" }, null, 2),
  );

  const env = {
    PATH: [dirname(process.execPath), "/usr/bin", "/bin"].join(":"),
    HOME: scratch,
    NODE_PATH: modulesDir,
    NO_COLOR: "1",
    ...(sdk.env ?? {}),
    ...(sdk.credentialEnv && credential ? { [sdk.credentialEnv]: credential } : {}),
  };

  const inside = (baseDir, p) => {
    const full = resolve(baseDir, p);
    return full === baseDir || full.startsWith(baseDir + sep) ? full : null;
  };

  const guard = target.onlyTouchOwn === false ? null : new OwnershipGuard({ owned: target.ownership?.owned });
  const mutating = new RegExp(target.ownership?.mutating ?? MUTATING_DEFAULT, "i");
  const rules = (target.ownership?.rules ?? []).map((r) => ({ match: new RegExp(r.match), ids: r.ids ?? null }));
  const docHosts = new Set((sdk.docsHosts ?? []).map((h) => h.toLowerCase()));

  const tools = [
    {
      name: "run_code",
      description: `Run a Node.js (ESM) script in the scratch directory. Import from '${pkgName}'. Authentication is already set in the environment. Standard output, standard error and the exit code are returned.`,
      inputSchema: {
        type: "object",
        properties: {
          code: { type: "string", description: "JavaScript ESM code to execute" },
        },
        required: ["code"],
      },
    },
    {
      name: "read_docs",
      description: `Read a documentation page, README or TypeScript declaration file (relative to the SDK package directory, or an allowed HTTP URL). Long files come in windows of ${WINDOW} characters: continue with offset.`,
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "Relative file path (e.g. 'README.md', 'dist/index.d.ts') or HTTP URL" },
          offset: { type: "integer", minimum: 0 },
        },
        required: ["url"],
      },
    },
    {
      name: "write_file",
      description: "Write a small helper file in the working directory (for example sample data). Relative paths only.",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string" }, content: { type: "string" } },
        required: ["path", "content"],
      },
    },
    {
      name: "read_file",
      description: "Read a text file from the working directory.",
      inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    },
  ];

  const runCode = (code) =>
    new Promise((resolveRun) => {
      const started = Date.now();
      const child = execFile(
        process.execPath,
        ["--input-type=module", "-e", code],
        { cwd: scratch, env, timeout: 60_000, maxBuffer: OUTPUT_CAP, encoding: "utf8" },
        (error, stdout, stderr) => {
          const codeStatus = error
            ? typeof error.code === "number"
              ? error.code
              : error.killed
                ? "timeout"
                : error.code ?? 1
            : 0;
          const text = `${stdout}${stderr ? `${stdout ? "\n" : ""}[stderr]\n${stderr}` : ""}\n[exit code ${codeStatus}, ${Date.now() - started} ms]`;
          resolveRun({ text, isError: codeStatus !== 0 });
        },
      );
      child.stdin.end();
    });

  const readDocs = async (urlStr, offset = 0) => {
    if (urlStr.startsWith("http://") || urlStr.startsWith("https://")) {
      let parsed;
      try { parsed = new URL(urlStr); } catch { return { text: "Not a valid URL", isError: true }; }
      if (!docHosts.has(parsed.hostname.toLowerCase())) {
        return { text: `Host ${parsed.hostname} is not allowed. Allowed: ${[...docHosts].join(", ")}`, isError: true };
      }
      const res = await fetch(parsed, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) return { text: `HTTP ${res.status} ${res.statusText}`, isError: true };
      const fullText = await res.text();
      const start = Math.max(0, Number(offset));
      const slice = fullText.slice(start, start + WINDOW);
      const nextOffset = start + WINDOW < fullText.length ? start + WINDOW : null;
      return {
        text: `${slice}\n\n[offset ${start}-${start + slice.length} of ${fullText.length} chars${nextOffset ? `, next_offset: ${nextOffset}` : ""}]`,
        isError: false,
      };
    }

    const localFile = inside(resolvedPkgPath, urlStr.replace(/^\/+/, ""));
    if (!localFile) return { text: "Path outside the SDK package directory.", isError: true };
    if (!existsSync(localFile)) return { text: `File not found: ${urlStr}`, isError: true };
    const fullText = readFileSync(localFile, "utf8");
    const start = Math.max(0, Number(offset));
    const slice = fullText.slice(start, start + WINDOW);
    const nextOffset = start + WINDOW < fullText.length ? start + WINDOW : null;
    return {
      text: `${slice}\n\n[offset ${start}-${start + slice.length} of ${fullText.length} chars${nextOffset ? `, next_offset: ${nextOffset}` : ""}]`,
      isError: false,
    };
  };

  return {
    kind: "sdk",
    label: "SDK package",
    info: { name: pkgName },
    tools,
    blurb: `You can use the SDK package '${pkgName}' by running short Node.js scripts with run_code (authentication is already set in the environment). Read its README, types or guides with read_docs.${sdk.docs?.length ? ` Start from: ${sdk.docs.join(", ")}.` : ""}`,
    coverageNoun: "method",
    limitKey: (toolName, args) => (toolName === "run_code" ? String(args.code ?? "") : toolName),
    coverageKey: (toolName, args) => {
      if (toolName !== "run_code" || !args.code) return null;
      const match = args.code.match(/(?:client|\w+)\.([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)?)\s*\(/);
      return match ? match[1] : "run_code";
    },
    check(toolName, args) {
      if (toolName !== "run_code") return null;
      if (typeof args.code !== "string") return "code must be a string";
      if (!guard || !mutating.test(args.code)) return null;
      return guard.refuse("run_code", [], args.code);
    },
    record(toolName, args, text) {
      if (toolName !== "run_code" || !guard) return;
      for (const rule of rules) {
        if (rule.match.test(args.code ?? "")) guard.recordIds(text, rule.ids);
      }
    },
    async call(toolName, args) {
      try {
        if (toolName === "run_code") return await runCode(args.code);
        if (toolName === "read_docs") return await readDocs(String(args.url), args.offset ?? 0);
        if (toolName === "write_file") {
          const full = inside(scratch, String(args.path));
          if (!full || String(args.content).length > 100_000) {
            return { text: "Path outside the working directory, or content over 100 KB.", isError: true };
          }
          mkdirSync(dirname(full), { recursive: true });
          writeFileSync(full, String(args.content));
          return { text: `Wrote ${String(args.content).length} characters to ${args.path}`, isError: false };
        }
        if (toolName === "read_file") {
          const full = inside(scratch, String(args.path));
          if (!full) return { text: "Path outside the working directory.", isError: true };
          return { text: readFileSync(full, "utf8").slice(0, 100_000), isError: false };
        }
        return { text: `Unknown tool ${toolName}`, isError: true };
      } catch (error) {
        return { text: `Failed: ${error.message}`, isError: true };
      }
    },
    async close() {
      rmSync(scratch, { recursive: true, force: true });
    },
  };
}
