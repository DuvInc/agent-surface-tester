// Surface "cli": a command line tool, run without a shell, in a scratch directory.
// Isolation, from the inside out: arguments are passed as an array (no shell, no pipes, no
// expansion); the environment is rebuilt from scratch (PATH, a fake HOME and XDG_CONFIG_HOME in the
// scratch directory, the credential in the one variable the tool reads); the working directory
// is a fresh temp folder deleted at the end; every run has a timeout and an output cap; some
// subcommands can be denied. The tool is expected to document itself: the agent starts from --help.
import { execFile } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { OwnershipGuard } from "../ownership.mjs";

const OUTPUT_CAP = 1_000_000;
const READ_ONLY_DEFAULT = "(^| )(list|get|show|status|preview|help|--help|-h|--version|-v|search|doctor|account|credits|usage)( |$)";

export function createCliSurface(target, { credential } = {}) {
  const cli = target.cli;
  if (!cli?.command?.length) throw new Error('A target with surface "cli" needs cli.command, e.g. ["node", "/path/to/cli.js"]');
  const [bin, ...baseArgs] = cli.command;
  const exe = bin === "node" ? process.execPath : bin;
  const name = cli.name ?? "cli";
  const deny = new Set(cli.deny ?? []);
  const scratch = mkdtempSync(join(tmpdir(), "agent-surface-tester-cli-"));
  mkdirSync(join(scratch, "home"), { recursive: true });
  const guard = target.onlyTouchOwn === false ? null : new OwnershipGuard();
  const readOnly = new RegExp(target.ownership?.readOnly ?? READ_ONLY_DEFAULT);
  const rules = (target.ownership?.rules ?? []).map((r) => ({ match: new RegExp(r.match), ids: r.ids ?? null }));
  const joined = (args) => (args.args ?? []).join(" ");

  const env = {
    PATH: [dirname(process.execPath), "/usr/bin", "/bin"].join(":"),
    HOME: join(scratch, "home"),
    XDG_CONFIG_HOME: join(scratch, "home", ".config"),
    NO_COLOR: "1",
    ...(cli.env ?? {}),
    ...(cli.credentialEnv && credential ? { [cli.credentialEnv]: credential } : {}),
  };

  const inside = (p) => {
    const full = resolve(scratch, p);
    return full === scratch || full.startsWith(scratch + sep) ? full : null;
  };

  const tools = [
    {
      name: "run_cli",
      description: `Run the command line tool \`${name}\` with the arguments you give (an array of strings, without the program name, no shell). Authentication is already set up. The result gives the output and the exit code. Files you write with write_file are in the working directory.`,
      inputSchema: {
        type: "object",
        properties: {
          args: { type: "array", items: { type: "string" }, description: `Arguments, e.g. ["--help"]` },
          stdin: { type: "string", description: "Text sent on standard input" },
        },
        required: ["args"],
      },
    },
    {
      name: "write_file",
      description: "Write a small text file in the working directory (for example something to upload). Relative paths only.",
      inputSchema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] },
    },
    {
      name: "read_file",
      description: "Read a text file from the working directory.",
      inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    },
  ];

  const run = (args, stdin) => new Promise((resolveRun) => {
    const started = Date.now();
    const child = execFile(exe, [...baseArgs, ...args], { cwd: scratch, env, timeout: 60_000, maxBuffer: OUTPUT_CAP, encoding: "utf8" }, (error, stdout, stderr) => {
      const code = error ? (typeof error.code === "number" ? error.code : error.killed ? "timeout" : (error.code ?? 1)) : 0;
      const text = `${stdout}${stderr ? `${stdout ? "\n" : ""}[stderr]\n${stderr}` : ""}\n[exit code ${code}, ${Date.now() - started} ms]`;
      resolveRun({ text, isError: code !== 0 });
    });
    if (stdin !== undefined) child.stdin.end(String(stdin)); else child.stdin.end();
  });

  return {
    kind: "cli",
    label: "command line tool",
    info: { name },
    tools,
    blurb: `You can run a command line tool, \`${name}\`, with the run_cli tool (arguments only, no shell; it is already signed in). Find out how it works yourself. You have a scratch directory for files (write_file, read_file).`,
    coverageNoun: "command",
    limitKey: (toolName, args) => (toolName === "run_cli" ? joined(args) : toolName),
    // `resources get res_abc...` and `resources get res_xyz...` count as one command; flags are ignored.
    coverageKey: (toolName, args) => (toolName === "run_cli"
      ? (args.args ?? []).filter((a) => !a.startsWith("-")).map((a) => (/^[a-z]{2,5}_[a-z0-9]{8,}$/.test(a) ? "{id}" : a)).slice(0, 3).join(" ")
      : null),
    check(toolName, args) {
      if (toolName !== "run_cli") return null;
      if (!Array.isArray(args.args) || args.args.some((a) => typeof a !== "string")) return "args must be an array of strings";
      if (args.args.length && deny.has(args.args[0])) return `Harness: the subcommand ${args.args[0]} is not available in this test.`;
      if (!guard || readOnly.test(joined(args))) return null;
      return guard.refuse(`${name} ${joined(args)}`, args.args, args.args.filter((a) => a.startsWith("-")).join(" "));
    },
    record(toolName, args, text) {
      if (toolName !== "run_cli") return;
      for (const rule of rules) if (rule.match.test(joined(args))) guard?.recordIds(text, rule.ids);
    },
    async call(toolName, args) {
      try {
        if (toolName === "run_cli") return await run(args.args, args.stdin);
        if (toolName === "write_file") {
          const full = inside(String(args.path));
          if (!full || String(args.content).length > 100_000) return { text: "Path outside the working directory, or content over 100 KB.", isError: true };
          mkdirSync(dirname(full), { recursive: true });
          writeFileSync(full, String(args.content));
          return { text: `Wrote ${String(args.content).length} characters to ${args.path}`, isError: false };
        }
        if (toolName === "read_file") {
          const full = inside(String(args.path));
          if (!full) return { text: "Path outside the working directory.", isError: true };
          return { text: readFileSync(full, "utf8").slice(0, 100_000), isError: false };
        }
        return { text: `Unknown tool ${toolName}`, isError: true };
      } catch (error) {
        return { text: `Failed: ${error.message}`, isError: true };
      }
    },
    async close() { rmSync(scratch, { recursive: true, force: true }); },
  };
}
