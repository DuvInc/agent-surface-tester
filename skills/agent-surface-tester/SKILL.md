---
name: agent-surface-tester
description: Test the MCP server, REST API, CLI or client SDK of a SaaS or product with cheap, unbiased AI agents, one interface and one sandbox workspace per agent, and collect their feedback on the agent experience. Use when the user wants to know how an agent finds, understands and uses their MCP server, API, CLI or SDK, or wants to rate or improve it before launch. Not for unit-testing the product's code, and not for load testing.
---

# Test an MCP server, API, CLI or SDK with agents

An agent that has never seen your product is the closest thing to its real user. This repository runs
one, gives it one interface (your MCP tools, your REST API and its docs, your CLI, or your client SDK),
a plain mission and a hard budget, and writes down what it did and what it thought. Read
[README.md](../../README.md) for the model of the tool and [AGENTS.md](../../AGENTS.md) for the code.
This file is the procedure.

## Principles that decide the quality of the result

1. **Feedback is input, not truth.** One agent saying a tool is confusing proves nothing. The same
   point from three different models is a signal. A point only one model raised is a hypothesis
   to check against the server. Agents also say false things (a model reported that a field was
   missing when the response had it). Verify a claim before acting on it, and keep the decision
   about what the product does with the humans who own it.
2. **Keep the tester unbiased.** The system prompt stays one neutral paragraph. Give it the
   product's one-line purpose, never your opinion of it. Do not tell it what you think is wrong.
3. **Several models, cheap ones.** A small paid model on the flex tier costs a few thousandths
   of a dollar for a full tour. Add two or three `:free` models for diversity: they are less
   reliable (rate limits, overloaded providers, shallower reports) but their agreement is cheap
   signal. A weak model can mistake the harness for a defect of the server.
4. **A prompt rule does not protect data.** A free model renamed an existing object despite
   "only change what you created". The harness enforces it (`lib/ownership.mjs`); do not run
   tests against a workspace holding real customer data.
5. **One agent per interface, one agent per workspace.** An agent given the MCP, the API, the CLI and the SDK mixes them. Two agents in one workspace collide. The harness locks on the credential; you provide one sandbox workspace and one key per interface you want to run at the same time.
6. **Cap everything.** `--max-cost`, `--max-steps`, and `limits` per operation in the target for
   anything that spends money or imports from the internet. Add `--max-prompt-tokens` when the
   model charges more past a context size (Claude Haiku 5.5: five times the price above 100k
   prompt tokens); a large MCP catalogue gets there in a few steps, since it is resent every step.
7. **Measure before you trust the bill.** Run one short probe (`--max-steps 4`) and read the
   report's tokens and cost before a campaign. With a provider key of your own on OpenRouter
   (BYOK), the cost is read from `cost_details.upstream_inference_cost`; check it is not zero.

## Steps

1. **Sandbox workspaces.** Ask the human for one empty workspace (account, project) per interface to test in parallel, each with a key made for the test, narrow scopes and enough credit for about ten paid operations (or spin up a local disposable instance of the product if the codebase supports it). Creating production accounts is a human step: do not sign up on a person's behalf. Never test against a workspace with real data or one other agents work in.
2. **Write the target files**, one per interface, from `targets/example*.json`: `surface`, `auth`, a `context` sentence, `rules`, `limits` for everything that costs money, `ownership` rules (which operations create things), `cleanup`. `ownership.owned` lists the ids of the workspace itself (organisation, suite, project) so the agent may create inside it; `ownership.idPattern` narrows what counts as an id (when option values such as `in_progress` look like one); `ownership.creating` is a regex over MCP tool names when they do not start or end with `create`, `add`, `duplicate`, `import` or `upload`. On a REST target with no rules, ids returned by a POST are the agent's. A workspace that is disposable as a whole (seeded only for the test, one agent) can set `"onlyTouchOwn": false`.
3. **List the tools** (`tools`). Mark which ones spend money or delete. Decide the limits. For a CLI, read `--help` yourself first to write `ownership.readOnly` and the creating commands; for an SDK, point `sdk.docs` at its `README.md` and `.d.ts` files.
4. **Plumbing check without a model**: one read-only call per interface (account, credits). Cheap, and it catches a wrong URL, path or scope before a run spends anything.
5. **First run: `missions/first-use.md`** with the cheapest model. It finds blockers fast.
6. **Full tour: `missions/full-tour.md`**, adapted: say which expensive calls are fine and how many. A prompt the user gave to a chat assistant works well as a mission.
7. **`edge-cases.md`** for error quality, **`docs-vs-reality.md`** for the accuracy of the documentation (the highest value on API, CLI and SDK), **`boundaries.md`** for permission errors.
8. **A realistic job** written like a customer would ask it, without mentioning tool names.
9. **Other models** on the same mission. Compare, do not average. Use a `suite` to run all interfaces in parallel.
10. **Clean up** with `cleanup`, check each workspace is back to its starting state, revoke the keys.
11. **Synthesise**: group findings by operation, mark each as agreed by N of M models and interfaces, verified or not, and propose changes. Present it as input to the owner's decision. The same friction across MCP, API, CLI and SDK points at the product; friction on one door points at that door.

## Authentication

Support, in this order of preference:

1. **A test API key**, put in an environment variable (`auth.type: "bearer"`), minted against a local sandbox instance, or copied to the clipboard (`--key-from-clipboard`). The agent never sees it: the harness adds the header or child environment variable.
2. **OAuth is not implemented.** It needs a browser and a person. Products that offer both OAuth and API keys (most do) can be tested with a key. If a product offers only OAuth, finish the flow yourself and pass the access token as `bearer` from an environment variable; tokens expire, so expect to repeat it.
3. **Letting the agent create its own account** is out of scope on purpose: most products forbid automated signups and an account created in production is a cost nobody asked for.

## Reading a report

The final report follows a fixed shape (score, what worked, friction with severity, missing behaviour,
coverage, unclear descriptions, what would make it a 10). Read the tool-call trace beside it:
a retry loop, a long call, or a harness refusal tells you more than the prose does.
