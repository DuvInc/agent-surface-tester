# Contributing

Thanks for looking. This is a one-person project maintained on a best-effort
basis, so the most useful thing you can do before writing code is open an issue.
A small fix is always welcome; a large one is worth agreeing on first.

## Getting set up

Node 22.18 or newer. There are no npm dependencies.

```bash
npm install     # installs nothing, and that is the point
npm test        # no network, no API key, no cost
```

`npm test` passes on a fresh clone with no keys: the end-to-end test runs the whole loop
against a fake MCP server and a fake model gateway on localhost. If it does not pass, that
is a bug worth reporting on its own.

To run it against your own server you need an OpenRouter key and a test credential for the
server. See the README.

## Sign your commits off

Every commit needs a `Signed-off-by` line, which certifies that you wrote the
patch or otherwise have the right to submit it under the MIT licence. This is
the [Developer Certificate of Origin](https://developercertificate.org): one
line, no paperwork, no copyright assignment.

```bash
git commit -s -m "Your message"
```

## What makes a change likely to be merged

**A bug fix comes with a test.** The guard and the client are small on purpose and each rule
in them exists because something went wrong: a model that renamed an object it had not
created, a server that answers in Server-Sent Events, a gateway that returns HTTP 200 with an
error in the body. Add the case to `test/`.

**The purity boundary holds.** `lib/openrouter.mjs` is the only file that reads a model key
and `lib/mcp-client.mjs` the only one that talks to the server under test. Everything else
takes its input as an argument. A change that reads `process.env` elsewhere in `lib/` makes
the library harder to embed and the tests harder to trust.

**The tester stays unbiased.** The system prompt describes the setup and the report format,
never an opinion about any server. A change that nudges the agent toward a verdict is a
regression even if the reports read better.

**Report what you measured.** For a prompt, format or default change, give the model, the
server, the cost and what changed in the reports.

**No new dependency.** A dependency needs an argument in an issue first.

**Comments explain why, not what.**

**No em dashes**, anywhere.

## Reporting a bug

Include the commit, the command, the model id, and the few lines of the trace around the
problem with anything that identifies a person or a customer replaced.

For anything with security implications, read [SECURITY.md](./SECURITY.md) instead of
opening a public issue.
