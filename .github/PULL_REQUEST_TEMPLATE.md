## What this changes

<!-- One or two sentences. If it fixes an issue, write "Fixes #123". -->

## Why

<!-- What went wrong or could not be done before. -->

## Checklist

- [ ] `npm test` passes locally
- [ ] Commits are signed off (`git commit -s`); see CONTRIBUTING.md
- [ ] A bug fix comes with a test that fails without it
- [ ] If the system prompt, the report format or a default changed: the model, the server, the cost and what changed in the reports are in this description
- [ ] `lib/` is still pure outside `lib/openrouter.mjs` (the model), `lib/mcp-client.mjs` and `lib/surfaces/` (the product): no env var, no log
- [ ] No new dependency, or it was discussed in an issue first
- [ ] No key, no report from a server you do not own, no customer name is in this diff
