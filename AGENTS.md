# Agent instructions

How to work in this repository. Claude Code, Cursor and Codex all read this file.

## What this is

A harness that runs a cheap AI agent against an MCP server and writes down its feedback. To
**use** it on a server, follow [skills/test-an-mcp-server](skills/test-an-mcp-server/SKILL.md). This file is for changing it.

## Layout

```text
lib/mcp-client.mjs   the only file that talks to the server under test (Streamable HTTP, JSON or SSE)
lib/openrouter.mjs   the only file that talks to the model, and the only one that reads its key
lib/agent.mjs        the loop: system prompt, report format, limits, budget, trace
lib/ownership.mjs    the guard: the agent may only change what it created in this session
bin/mcp-agent-tester.mjs   CLI: tools | run | cleanup, reads the credential, writes the report
missions/            plain Markdown tasks
targets/example.json    the shape of a target file
test/                no network, no key, no cost
```

## Commands

```bash
npm test                          # unit tests and an end-to-end run against fakes on localhost
node --check bin/mcp-agent-tester.mjs
```

## Rules

1. **Two files touch the outside.** `lib/openrouter.mjs` (model) and `lib/mcp-client.mjs` (server). Everything else is pure and takes its input as an argument.
2. **Secrets are read when called**, from the environment, never at import, never printed, never written to a report, never shown to the model. The credential goes into a header the harness adds.
3. **The harness enforces, the prompt informs.** A rule that matters (ownership, per-tool limits, budget) lives in code. A model ignored a prompt rule once.
4. **The tester stays unbiased.** Do not put an opinion about any server in the system prompt.
5. **Zero npm dependencies.** Argue in an issue first.
6. **A bug fix comes with a test** that fails without it. Comments say why, and what broke before.
7. **No em dashes**, in code, docs or reports.
8. **Commits are signed off**: `git commit -s`.

## Things that bite

- **A gateway can answer HTTP 200 with an error in the body.** `lib/openrouter.mjs` checks `json.error`.
- **Flex can fail with a capacity error.** The first attempt asks for flex, the retry does not. `:free` models never use flex.
- **Free models are flaky**: 429, 403, "temporarily overloaded" mid-run. `runAgent` catches a model error, stops cleanly and still writes the report.
- **An ask tool returns ids it does not own** (citations point at other objects). The target's `ownership.alsoRecord` limits which ids a tool may hand to the agent.
- **Tool output is cut** at 8000 characters in the model's context (the full text stays in the trace). The prompt tells the agent not to report that as a server defect, and weak models do anyway.
- **Reports are not source.** `reports/` is gitignored. Do not commit a report from a server you do not own.
