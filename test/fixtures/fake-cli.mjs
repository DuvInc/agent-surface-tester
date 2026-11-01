// A tiny CLI used by the tests: prints what it was given so the tests can see the isolation.
const [cmd, sub, arg] = process.argv.slice(2);
if (cmd === "--help") console.log("fake-cli: things create | things rename <id> | env");
else if (cmd === "things" && sub === "create") console.log(JSON.stringify({ id: "thg_abcdefgh2345" }));
else if (cmd === "things" && sub === "rename") console.log(JSON.stringify({ renamed: arg }));
else if (cmd === "env") console.log(JSON.stringify({
  key: process.env.FAKE_KEY === "cli-secret" ? "set" : "missing",
  leaked: process.env.SHOULD_NOT_LEAK ?? null,
  homeIsScratch: process.env.HOME?.includes("agent-surface-tester-cli-"),
  cwdIsScratch: process.cwd().includes("agent-surface-tester-cli-"),
}));
else { console.error("unknown command"); process.exit(2); }
