import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireLock, lockKey } from "../lib/lock.mjs";

test("one agent per workspace: second run is refused, then allowed after release", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lock-test-"));
  const key = lockKey("some-api-key");
  const release = await acquireLock(key, { dir, label: "first" });
  await assert.rejects(acquireLock(key, { dir, label: "second" }), /in use by another agent/);
  release();
  const again = await acquireLock(key, { dir });
  again();
});

test("a lock left by a dead process is taken over", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lock-test-"));
  const key = lockKey("another-key");
  writeFileSync(join(dir, `${key}.lock`), JSON.stringify({ pid: 2 ** 22 + 12345, label: "crashed" }));
  const release = await acquireLock(key, { dir });
  release();
});

test("the lock key follows the credential, not the target file", () => {
  assert.equal(lockKey("same"), lockKey("same"));
  assert.notEqual(lockKey("a"), lockKey("b"));
});
