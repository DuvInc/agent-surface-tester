---
name: test-an-mcp-server
description: Test the MCP server, REST API or CLI of a SaaS or product with cheap, unbiased AI agents, one surface and one sandbox workspace per agent, and collect their feedback on the agent experience. Use when the user wants to know how an agent finds, understands and uses their MCP server, API or CLI, or wants to rate or improve it before launch. Not for unit-testing the product's code, and not for load testing.
---

# Test an MCP server, an API or a CLI with agents

An agent that has never seen your server is the closest thing to its real user. This repository runs
one, gives it your MCP tools, a plain mission and a budget, and writes down what it did and what it
thought. Read [README.md](../../README.md) for the model of the tool and [AGENTS.md](../../AGENTS.md)
for the code. This file is the procedure.

## Principles that decide the quality of the result

1. **Feedback is input, not truth.** One agent saying a tool is confusing proves nothing. The same
   point from three different models is a signal. A point only one model raised is a hypothesis
   to check against the server. Agents also say false things (a model reported that a field was
   missing when the response had it). Verify a claim before acting on it, and keep the decision
   about what the server does with the humans who own it.
2. **Keep the tester unbiased.** The system prompt stays one neutral paragraph. Give it the
   product's one-line purpose, never your opinion of it. Do not tell it what you think is wrong.
3. **Several models, cheap ones.** A small paid model on the flex tier costs a few thousandths
   of a dollar for a full tour. Add two or three `:free` models for diversity: they are less
   reliable (rate limits, overloaded providers, shallower reports) but their agreement is cheap
   signal. A weak model can mistake the harness for a defect of the server.
4. **A prompt rule does not protect data.** A free model renamed an existing object despite
   "only change what you created". The harness enforces it (`lib/ownership.mjs`); do not run
   tests against a workspace holding real customer data.
5. **One agent per surface, one agent per workspace.** An agent given the MCP, the API and the CLI mixes them. Two agents in one workspace collide. The harness locks on the credential; you provide one sandbox workspace and one key per surface you want to run at the same time.
6. **Cap everything.** `--max-cost`, `--max-steps`, and `limits` per tool in the target for
   anything that spends money or imports from the internet.

## Steps

1. **Sandbox workspaces.** Ask the human for one empty workspace (account, project) per surface to test in parallel, each with a key made for the test, narrow scopes and enough credit for about ten paid operations. Creating accounts or workspaces is a human step: do not sign up on a person's behalf. Give them a numbered checklist with the URL, every field and the exact values, and what to send back. Never test against a workspace with real data or one other agents work in.
2. **Write the target files**, one per surface, from `targets/example*.json`: `surface`, `auth`, a `context` sentence, `rules`, `limits` for everything that costs money, `ownership` rules (which operations create things), `cleanup`.
3. **List the tools** (`tools`). Mark which ones spend money or delete. Decide the limits. For a CLI, read `--help` yourself first to write `ownership.readOnly` and the creating commands.
4. **Plumbing check without a model**: one read-only call per surface (account, credits). Cheap, and it catches a wrong URL or scope before a run spends anything.
5. **First run: `missions/first-use.md`** with the cheapest model. It finds blockers fast.
6. **Full tour: `missions/full-tour.md`**, adapted: say which expensive calls are fine and how many. A prompt the user gave to a chat assistant works well as a mission.
7. **`edge-cases.md`** for error quality, **`docs-vs-reality.md`** for the accuracy of the documentation (the highest value on API and CLI), **`boundaries.md`** for permission errors.
8. **A realistic job** written like a customer would ask it, without mentioning tool names.
9. **Other models** on the same mission. Compare, do not average. Use a `suite` to run all surfaces in parallel.
10. **Clean up** with `cleanup`, check each workspace is back to its starting state, revoke the keys.
11. **Synthesise**: group findings by operation, mark each as agreed by N of M models and surfaces, verified or not, and propose changes. Present it as input to the owner's decision. The same friction on the MCP, the API and the CLI points at the product; a friction on one surface points at that surface.

## Authentication

Support, in this order of preference:

1. **A test API key made by a human**, put in an environment variable (`auth.type: "bearer"`) or
   copied to the clipboard (`--key-from-clipboard`). The agent never sees it: the harness adds the header.
2. **OAuth is not implemented.** It needs a browser and a person. Servers that offer both OAuth and
   API keys (most do) can be tested with a key. If a server offers only OAuth, finish the flow
   yourself, and pass the access token as `bearer` from an environment variable; tokens expire, so
   expect to repeat it.
3. **Letting the agent create its own account** is out of scope on purpose: most products forbid
   automated signups and an account created in production is a cost nobody asked for. If you want to
   measure that friction anyway, make it a separate human-supervised experiment.

## Reading a report

The final report follows a fixed shape (score, what worked, friction with severity, missing behaviour,
tool coverage, unclear descriptions, what would make it a 10). Read the tool-call trace beside it:
a retry loop, a long call, or a harness refusal tells you more than the prose does.
