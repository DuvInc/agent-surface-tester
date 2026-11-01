---
name: test-an-mcp-server
description: Test the MCP server of a SaaS or product with cheap, unbiased AI agents and collect their feedback on the agent experience. Use when the user wants to know how an agent finds, understands and uses their MCP server, or wants to rate or improve it before launch. Not for unit-testing the server's code, and not for load testing.
---

# Test an MCP server with agents

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
5. **Cap everything.** `--max-cost`, `--max-steps`, and `limits` per tool in the target for
   anything that spends money or imports from the internet.

## Steps

1. **Get a credential made for the test** (see "Authentication" below). Never use a production
   admin key. Narrow scopes. Note it for revocation.
2. **Write the target file** from `targets/example.json`: URL, `auth`, a `context` sentence, `rules`,
   per-tool `limits`, and a `cleanup` section so a crashed run can be cleaned up.
3. **List the tools** (`tools`). Mark which ones spend money or delete. Decide the limits.
4. **Snapshot the workspace** before (list the objects), so you can show nothing else changed.
5. **First run: `missions/first-use.md`** with the cheapest model. It finds blockers fast.
6. **Full tour: `missions/full-tour.md`**, adapted: say which expensive calls are fine and how many.
   Add the user's own words if they have a mission in mind (a prompt they gave to another agent works
   well as a mission).
7. **Edge cases: `missions/edge-cases.md`** for error quality.
8. **A realistic job** written like a customer would ask it, without mentioning tool names.
9. **Other models** on the same mission. Compare, do not average.
10. **Clean up** with `cleanup`, snapshot again, revoke the key.
11. **Synthesise**: group findings by tool, mark each as agreed by N of M models, verified or not,
    and propose changes. Present it as input to the owner's decision.

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
