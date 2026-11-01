# mcp-agent-tester

**You built an MCP server, a REST API and a CLI for agents. Have you watched an agent use them?**

This runs a cheap AI agent that has never seen your product, gives it **one surface** (your MCP tools, or your REST API and its documentation, or your command line), a plain mission and a hard budget, and writes down what it did and what it thought: what was obvious, what it had to guess, what broke, what it expected to work differently. The agent is the user your tool descriptions, your OpenAPI file and your `--help` were written for.

```bash
cp targets/example.json targets/my-server.json     # URL, how to authenticate, one sentence of context
node --env-file=.env bin/mcp-agent-tester.mjs tools --target targets/my-server.json
node --env-file=.env bin/mcp-agent-tester.mjs run    --target targets/my-server.json \
  --mission missions/full-tour.md --model openai/gpt-6-luna --flex --max-cost 0.05
# MCP server: my-server 1.0.0, 48 tools
# · get_account {}  (212 ms)
# · add_text_resource {"title":"mcp-test-notes", ...}  (1619 ms)
# ...
# Cost $0.00441, 52 tool calls, stopped by finished
# Report: reports/2026-11-01-11-57-02_mcp_full-tour_openai-gpt-6-luna.md
```

The report has a score out of 10, what worked, friction with a severity, missing behaviour, coverage, unclear descriptions and "what would make it a 10". Next to it sits the trace of every call, with duration, outcome, and the coverage the harness measured itself (how many distinct tools, endpoints or commands were actually used).

## Three surfaces, one agent each

| Surface | What the agent gets | How it learns the product |
| :--- | :--- | :--- |
| `mcp` | The tools the server lists, as they are, annotations included | The tool descriptions, which is all a model has |
| `api` | `http_request` (base URL fixed, credential added by the harness) and `read_docs` (GET on the doc hosts you list, in windows of 12,000 characters) | `llms.txt`, the OpenAPI file, your guides: it has to find its way, as a real agent does |
| `cli` | `run_cli` (an argument array, no shell), `write_file` and `read_file` in a scratch folder | `--help`, the output of the tool, its error messages |

One surface per run, on purpose. An agent that can use the MCP, the API and the CLI mixes them and you learn about none. Run the same mission on each surface to see which door agents take most easily.

## What it cost, measured

Run against the MCP server of a SaaS with 48 tools, on 2026-11-01. Ten runs, 335 tool calls, $0.0123 in total.

| Run | Model | Tool calls | Cost |
| :--- | :--- | ---: | ---: |
| Full tour, every tool it can reach | `openai/gpt-6-luna`, flex tier, low reasoning | 44, then 52 | $0.0034, $0.0044 |
| First contact, small realistic job | same | 6 | $0.0020 |
| A customer-style job, no tool names | same; and `nvidia/nemotron-3-ultra-550b-a55b:free` | 8; 9 | $0.0012; $0 |
| Errors and edge cases | same | 14 | $0.0014 |
| Full tour | `nvidia/nemotron-3-ultra-550b-a55b:free` (twice), `nvidia/nemotron-3.5-super-vl:free`, `cohere/north-mini-code:free` | 39 to 66 | $0 |

Two other free models failed before the first tool call (rate limit, access policy). That is normal for free tiers: run a mission on several models and expect some not to answer.

## How it works

```text
mission.md ──► agent loop ◄──► any tool-calling model (OpenRouter, or any OpenAI-compatible gateway)
                  │
                  ├─ limits per operation, --max-steps, --max-cost                      (hard)
                  ├─ ownership guard: may only change what it created this session      (hard)
                  ├─ one run at a time per workspace (lock keyed on the credential)     (hard)
                  ▼
        surface: MCP client │ HTTP tool + docs reader │ CLI in a scratch directory
                  │
                  └─► report.md + trace.json
```

Decisions, and what was rejected:

- **One agent per run, one neutral system prompt.** The prompt describes the setup and the report format, nothing about your product beyond a sentence you write. A tester that has been told what you worry about finds it.
- **The harness enforces the rules, the prompt informs.** The first free model tested renamed and paused an object it had not created, in spite of "only change what you created" in its instructions. `lib/ownership.mjs` remembers the ids that creating operations returned and refuses any other call that changes an id it does not know. On HTTP and CLI the same guard reads the path and the arguments. The harness also adds the credential itself, so the model never sees it.
- **One agent per workspace.** Two agents in the same workspace read each other's objects, rename them and delete them, and the feedback becomes about the collision. `lib/lock.mjs` refuses a second run on a credential that is already in use (a crashed run does not block anyone: a lock whose process is gone is taken over). To test three surfaces at once, give each its own workspace and its own key: `suite` runs them in parallel and queues runs that share a workspace.
- **The CLI is isolated from the inside out.** Arguments are an array, so there is no shell, no pipe and no expansion. The environment is rebuilt from nothing: `PATH`, a fake `HOME` in the scratch folder, the credential in the one variable the tool reads. The working folder is a fresh temp folder, deleted at the end. Each call has a timeout and an output cap, and you can deny subcommands. That is a boundary against a confused model, not against a hostile one: for that, run the whole thing in a container.
- **Cheap models, several of them.** A full tour is about 300k input tokens. On a small model on the flex tier that is half a cent. Free models cost nothing and add diversity. One model's opinion is a hypothesis; the same point from three models is a signal.
- **No dependency, no cloud account.** The MCP client is 90 lines of `fetch`. It speaks the Streamable HTTP transport, reads JSON or Server-Sent Events answers, and does not need a session. Everything runs on your machine; it needs a model key and a credential for the product, nothing else.

## Feedback is input, not a verdict

Treat every report as one user's view.

- Models disagree. In the runs above, one said a response lacked a field that another had just shown. Verify a claim against the server before acting on it.
- Models flatter. Scores of 7 to 9 out of 10 came with real defects named inside. Read the friction list, not the score.
- Weak models misread the harness as the server's fault. The prompt says not to; some do anyway.
- What your server should do is your decision. An agent that finds a tool confusing tells you about the description, not about the product.

## Try it locally

```bash
git clone https://github.com/DuvInc/mcp-agent-tester && cd mcp-agent-tester
npm test                      # no network, no key: fake servers and a fake model gateway on localhost
cp .env.example .env          # OPENROUTER_API_KEY, and the credential of the server you test
```

Without a key, `npm test` still runs the whole loop against fakes.

## Authentication, honestly

| How the server wants you to sign in | Supported | How |
| :--- | :--- | :--- |
| An API key you create | yes | `"auth": {"type": "bearer", "env": "MY_KEY"}`, or `--key-from-clipboard` after you copy it |
| OAuth | not directly | Create a key instead if the server offers one. Otherwise do the flow yourself and pass the access token as `bearer` |
| The agent signs up and creates its own account | no, on purpose | Most products forbid automated signups, and an account in production is a cost nobody asked for |

Use a key made for the test, with the narrowest scopes, on a workspace that holds nothing real, and revoke it afterwards.

## Putting it in your product

1. **A sandbox workspace per surface.** Create a separate workspace (or account, or project) for each surface you test, with its own test credential, the narrowest scopes that let the agent work, and some credit. Nothing real in it. Revoke the keys when you are done.
2. **A target file per surface** (`targets/example.json`, `example-api.json`, `example-cli.json`): `surface`, how to authenticate, a `context` sentence, `rules`, `limits` on everything that spends money or imports from the internet, `ownership` rules that say which operations create things, and a `cleanup` section.
3. **Missions** are plain Markdown with `{{surface}}` filled in: `first-use`, `full-tour`, `edge-cases` (errors), `docs-vs-reality` (every claim in the documentation checked against the product), `boundaries` (what the credential may and may not do, and how clearly it says so). A prompt you gave to a chat assistant makes a good mission as it is.
4. **A suite** (`suites/example.json`) lists runs: surface, mission, model, budget. `mcp-agent-tester suite --suite suites/my.json` runs them, three at a time across workspaces.
5. **After a crashed run**, `cleanup` deletes everything whose name starts with the `cleanup.prefix` (default `mcp-test-`), through an MCP endpoint of the same workspace.

The model contract, if you want another provider, is one function: `chat(body, { flex })` in `lib/openrouter.mjs`, which takes an OpenAI-style chat-completions body with `tools` and returns `{ message, usage, cost, tier }`. Any OpenAI-compatible gateway works with `LLM_BASE_URL` and `LLM_API_KEY`; cost reporting and the flex tier are OpenRouter features.

If you use a coding agent, [skills/test-an-mcp-server](skills/test-an-mcp-server/SKILL.md) is the procedure written for it.

## What this is not

- **Not a test suite.** It finds what an agent finds confusing, not whether your server returns the right bytes. Keep your own tests.
- **Not a benchmark.** Ten runs on one server say nothing about how models rank.
- **Not safe on real data.** The guard stops a mistaken model from changing what it did not create. It does not stop it from reading, and it does not make an admin key safe to hand over.
- **Not OAuth, not browsers, not stdio servers.** Remote MCP servers over HTTP, REST over HTTPS and local command line tools, for now. No SDK surface yet.
- **Not an attack tool.** The `boundaries` mission checks that refusals are clear. It does not try to get around anything.
- **Not a judge of your product.** Agents tell you how it feels to use. Whether to change it is yours to decide.

## Credits

Models through [OpenRouter](https://openrouter.ai). MIT licence. See [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md).
