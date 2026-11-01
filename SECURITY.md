# Security policy

## Reporting a vulnerability

Please report privately rather than in a public issue, using GitHub's
[private vulnerability reporting](https://github.com/DuvInc/mcp-agent-tester/security/advisories/new)
on this repository.

This is a one-person project. You should get an acknowledgement within a few
days; if a week passes with no reply, feel free to nudge by opening a public
issue that says only that you are waiting on a private report, with no details.

## What is in scope

This tool lets a language model call the tools of an MCP server with a credential you
provide. The surface that matters:

- **Key handling.** Anything that causes `OPENROUTER_API_KEY` or the credential of the server
  under test to be printed, written to a report or a tracked file, shown to the model, or sent
  anywhere other than the configured hosts. The model must never see the credential: the
  harness adds the header.
- **The ownership guard.** `lib/ownership.mjs` is meant to stop a run from changing or deleting
  anything the agent did not create. A way around it is in scope.
- **The limits.** Per-tool call limits, `--max-steps` and `--max-cost` are meant to be hard. A
  way to exceed them is in scope.
- **Untrusted text.** Everything a server returns ends up in the model's context and in a
  Markdown report. Text that makes the harness do something it should not (not merely text that
  steers the model, which no harness can prevent) is worth reporting.

## What is out of scope

- OpenRouter, the model providers and the servers you test. Report those to their operators.
- Report quality. A model that invents a finding is a known property of models, and the README
  says to verify before acting.
- A vulnerability that requires the attacker to already have commit access, or to already be
  able to run code as you.

## If you run this on your own product

Three things this repository cannot do for you:

- **Use a test credential.** Give the agent a key made for the run, with the narrowest scopes
  that let it work, against a workspace that holds nothing real. A guard and a prompt reduce the
  harm of a mistaken model; they do not make an admin key safe to hand over.
- **Expect untrusted content.** If the server returns text written by third parties, that text
  reaches the model and can try to steer it. The scopes of the credential are what bound the
  damage.
- **Keep reports out of your repositories.** `reports/` holds what the server answered during
  the test. It is gitignored here.

## If you forked this tool

Replace the link above with your own repository. This file arrived with the
code and points at somebody else's advisories.
