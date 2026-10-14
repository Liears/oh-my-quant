import { afterEach, beforeEach, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { checkSkillFiles, readSkillFiles, skillFileRevision } from "../file-probe.ts";

let root: string, entry: string;
const content = "Reviewed fixture\nNo code is executed.\n";
const files = { "SKILL.md": createHash("sha256").update(content).digest("hex"),
  "scripts/helper.py": createHash("sha256").update("raise RuntimeError('must not execute')\n").digest("hex") };
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "whyj-file-probe-")); entry = join(root, "SKILL.md");
  mkdirSync(join(root, "scripts"));
  writeFileSync(entry, content);
  writeFileSync(join(root, "scripts/helper.py"), "raise RuntimeError('must not execute')\n");
});
afterEach(() => {
  const within = relative(realpathSync(tmpdir()), realpathSync(root));
  if (!within.startsWith("whyj-file-probe-") || within.includes(sep)) throw new Error("Unsafe cleanup");
  rmSync(root, { recursive: true, force: true });
});

it("compares contents without execution, accepts Git CRLF and isolates observations by workspace, path and manifest", () => {
  expect(readSkillFiles(root, entry, files).status).toBe("unverified");
  writeFileSync(entry, content.replace(/\n/g, "\r\n"));
  expect(checkSkillFiles(root, entry, files).status).toBe("available");
  const observed = readSkillFiles(root, entry, files);
  expect(observed.reason).toContain("Checked"); observed.status = "missing";
  expect(readSkillFiles(root, entry, files).status).toBe("available");
  expect(readSkillFiles(root, join(root, "other/SKILL.md"), files).status).toBe("unverified");
  expect(readSkillFiles(join(root, "other-workspace"), entry, files).status).toBe("unverified");
  expect(readSkillFiles(root, entry, { ...files, "SKILL.md": "changed-review" }).status).toBe("unverified");
});

it("revokes success after modified or missing script checks and publishes a revision for session refresh", () => {
  checkSkillFiles(root, entry, files);
  const revision = skillFileRevision(root);
  writeFileSync(join(root, "scripts/helper.py"), "modified\n");
  expect(checkSkillFiles(root, entry, files)).toMatchObject({ status: "unverified", reason: "scripts/helper.py: differs from reviewed content" });
  expect(skillFileRevision(root)).toBe(revision + 1);
  rmSync(join(root, "scripts/helper.py"));
  expect(checkSkillFiles(root, entry, files)).toMatchObject({ status: "missing", reason: "scripts/helper.py: missing" });
  expect(readSkillFiles(root, entry, files).status).toBe("missing");
});

it("does not replace a previous observation on cancellation", () => {
  checkSkillFiles(root, entry, files);
  const before = readSkillFiles(root, entry, files), revision = skillFileRevision(root);
  const controller = new AbortController(); controller.abort();
  expect(() => checkSkillFiles(root, entry, files, controller.signal)).toThrow();
  expect(readSkillFiles(root, entry, files)).toEqual(before);
  expect(skillFileRevision(root)).toBe(revision);
});

it("rejects empty manifests, oversized files and directories without exposing file contents", () => {
  expect(checkSkillFiles(root, entry, {}).status).toBe("unverified");
  writeFileSync(entry, "secret".repeat(50_000));
  const result = checkSkillFiles(root, entry, files);
  expect(result.status).toBe("unverified"); expect(result.reason).not.toContain("secret");
  expect(checkSkillFiles(root, entry, { scripts: "anything" }).status).toBe("unverified");
});

it("invalidates an edited checked file even when size and modification time are preserved, and requires explicit recheck after repair", () => {
  checkSkillFiles(root, entry, files); const revision = skillFileRevision(root), stat = statSync(entry);
  writeFileSync(entry, content.replace("Reviewed", "ReviEwed")); utimesSync(entry, stat.atime, stat.mtime);
  expect(statSync(entry).size).toBe(stat.size);
  expect(readSkillFiles(root, entry, files).status).toBe("unverified");
  expect(skillFileRevision(root)).toBe(revision + 1);
  writeFileSync(entry, content);
  expect(readSkillFiles(root, entry, files).status).toBe("unverified");
  expect(skillFileRevision(root)).toBe(revision + 1);
  expect(checkSkillFiles(root, entry, files).status).toBe("available");
  expect(skillFileRevision(root)).toBe(revision + 2);
});

it("publishes missing-file revocation before session refresh and keeps an unrelated workspace observation valid", () => {
  checkSkillFiles(root, entry, files); const revision = skillFileRevision(root);
  const other = join(root, "other-workspace"); mkdirSync(join(other, "scripts"), { recursive: true });
  writeFileSync(join(other, "SKILL.md"), content);
  writeFileSync(join(other, "scripts/helper.py"), "raise RuntimeError('must not execute')\n");
  checkSkillFiles(other, join(other, "SKILL.md"), files); const otherRevision = skillFileRevision(other);
  rmSync(join(root, "scripts/helper.py"));
  expect(skillFileRevision(root)).toBe(revision + 1);
  expect(readSkillFiles(root, entry, files).status).toBe("missing");
  expect(skillFileRevision(other)).toBe(otherRevision);
  expect(readSkillFiles(other, join(other, "SKILL.md"), files).status).toBe("available");
});

it("revokes a successful observation when a checked file grows beyond its read bound without exposing content", () => {
  checkSkillFiles(root, entry, files);
  writeFileSync(entry, "PRIVATE_REPLACEMENT".repeat(16000));
  const result = readSkillFiles(root, entry, files);
  expect(result.status).toBe("unverified"); expect(result.reason).not.toContain("PRIVATE_REPLACEMENT");
});

it("keeps the successful revision stable across unchanged reads and Git line-ending changes", () => {
  checkSkillFiles(root, entry, files); const revision = skillFileRevision(root);
  writeFileSync(entry, content.replace(/\n/g, "\r\n"));
  expect(readSkillFiles(root, entry, files).status).toBe("available");
  expect(skillFileRevision(root)).toBe(revision);
  expect(skillFileRevision(root)).toBe(revision);
});
