// One agent per workspace. Two agents in the same workspace read each other's objects, rename them,
// delete them, and the feedback becomes about the collision. The lock is keyed on the credential
// (the same key means the same workspace, whatever the target file is called) and lives in the
// temp directory, so a crashed run does not block anyone: a lock whose process is gone is taken over.
import { createHash } from "node:crypto";
import { mkdirSync, openSync, closeSync, writeSync, readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function lockKey(credential) {
  return createHash("sha256").update(credential ?? "no-credential").digest("hex").slice(0, 16);
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };

export async function acquireLock(key, { waitSeconds = 0, dir = join(tmpdir(), "mcp-agent-tester-locks"), label = "" } = {}) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${key}.lock`);
  const deadline = Date.now() + waitSeconds * 1000;
  for (;;) {
    try {
      const fd = openSync(file, "wx");
      writeSync(fd, JSON.stringify({ pid: process.pid, label, since: new Date().toISOString() }));
      closeSync(fd);
      const release = () => { try { unlinkSync(file); } catch {} };
      process.once("exit", release);
      return release;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let holder = {};
      try { holder = JSON.parse(readFileSync(file, "utf8")); } catch {}
      if (holder.pid && !alive(holder.pid)) { try { unlinkSync(file); } catch {} continue; }
      if (Date.now() >= deadline) {
        throw new Error(`This workspace is in use by another agent run (pid ${holder.pid}, ${holder.label || "no label"}, since ${holder.since}). Use another sandbox workspace, or --wait-lock <seconds>.`);
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}
