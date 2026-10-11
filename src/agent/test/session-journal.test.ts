import { afterEach, beforeEach, expect, it } from "bun:test";
import { appendFileSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { JsonlSessionRepo } from "../src/session-runtime/index.ts";
import { NodeExecutionEnv } from "../src/session-runtime/node.ts";
import { LocalSessionFile, subscribeFileEvents } from "../../storage/index.ts";
import type { SessionFilePort } from "../../types/session-file.ts";
import { lockSync } from "proper-lockfile";

let root: string;
let repo: JsonlSessionRepo;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ohq-session-journal-"));
  repo = new JsonlSessionRepo({ fs: new NodeExecutionEnv({ cwd: root }), sessionsRoot: root });
});
afterEach(() => {
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected session test directory");
  rmSync(root, { recursive: true, force: true });
});

it("rejects stale session writers instead of silently continuing an outdated branch", async () => {
  const first = await repo.create({ cwd: root });
  await first.appendMessage({ role: "user", content: "Original research", timestamp: 1 });
  const meta = await first.getMetadata();
  const stale = await repo.open(meta);
  const oldEntries = await stale.getEntries();
  await first.appendMessage({ role: "user", content: "New research", timestamp: 2 });
  const committed = readFileSync(meta.path, "utf8");
  await expect(stale.appendMessage({ role: "user", content: "Stale context", timestamp: 3 })).rejects.toThrow("changed");
  expect(readFileSync(meta.path, "utf8")).toBe(committed);
  expect(await stale.getEntries()).toEqual(oldEntries);
  const reopened = await repo.open(meta);
  await reopened.appendMessage({ role: "user", content: "Continue latest", timestamp: 4 });
  expect((await reopened.getBranch()).map(entry => entry.type === "message" && "content" in entry.message ? entry.message.content : "")).toEqual(["Original research", "New research", "Continue latest"]);
});

it("serializes concurrent appends and navigation on one session without losing branch context", async () => {
  const session = await repo.create({ cwd: root });
  const ids = await Promise.all(Array.from({ length: 32 }, (_, i) => session.appendMessage({ role: "user", content: `Request ${i}`, timestamp: i })));
  expect(new Set(ids).size).toBe(32);
  expect((await session.getBranch()).map(entry => entry.id)).toEqual(ids);
  const moving = session.moveTo(ids[4]!, { summary: "Research from the first five requests" });
  const next = session.appendMessage({ role: "user", content: "Continue selected branch", timestamp: 33 });
  const [summaryId, nextId] = await Promise.all([moving, next]);
  expect((await session.getBranch()).map(entry => entry.id)).toEqual([...ids.slice(0, 5), summaryId!, nextId]);
  expect(await (await repo.open(await session.getMetadata())).getBranch()).toEqual(await session.getBranch());
});

it("preserves state on failed writes and commits navigation plus summary in one transaction", async () => {
  const local = new LocalSessionFile();
  let fail = false;
  let writes = 0;
  const file: SessionFilePort = {
    read: path => local.read(path), remove: (path, revision) => local.remove(path, revision),
    commit: async (path, revision, text, signal) => {
      writes++;
      if (fail) throw new Error("Simulated disk failure");
      return local.commit(path, revision, text, signal);
    },
  };
  repo = new JsonlSessionRepo({ fs: new NodeExecutionEnv({ cwd: root }), sessionsRoot: root, file });
  const session = await repo.create({ cwd: root });
  const first = await session.appendMessage({ role: "user", content: "Original", timestamp: 1 });
  await session.appendMessage({ role: "user", content: "Latest", timestamp: 2 });
  const meta = await session.getMetadata();
  const before = readFileSync(meta.path, "utf8");
  const entries = await session.getEntries();
  fail = true;
  await expect(session.moveTo(first, { summary: "Move atomically" })).rejects.toThrow("disk failure");
  expect(await session.getEntries()).toEqual(entries);
  expect(await session.getLeafId()).toBe(entries.at(-1)!.id);
  expect(readFileSync(meta.path, "utf8")).toBe(before);
  fail = false;
  writes = 0;
  const summary = await session.moveTo(first, { summary: "Move atomically" });
  expect(writes).toBe(1);
  expect((await session.getBranch()).map(entry => entry.id)).toEqual([first, summary!]);

  fail = true;
  const listing = await repo.list();
  await expect(repo.fork(meta, { cwd: root })).rejects.toThrow("disk failure");
  expect(await repo.list()).toEqual(listing);
  fail = false;
  writes = 0;
  const fork = await repo.fork(meta, { cwd: root });
  expect(writes).toBe(1);
  expect(await fork.getEntries()).toEqual(await session.getEntries());
  expect(await fork.getBranch()).toEqual(await session.getBranch());
});

it("retries an unacknowledged exact entry without duplicating disk history", async () => {
  const local = new LocalSessionFile();
  let loseAck = false;
  const file: SessionFilePort = {
    read: path => local.read(path), remove: (path, revision) => local.remove(path, revision),
    commit: async (path, revision, text, signal) => {
      const saved = await local.commit(path, revision, text, signal);
      if (loseAck) throw new Error("Lost acknowledgement");
      return saved;
    },
  };
  repo = new JsonlSessionRepo({ fs: new NodeExecutionEnv({ cwd: root }), sessionsRoot: root, file });
  const session = await repo.create({ cwd: root });
  const entry = { type: "message" as const, id: "retry-transaction", parentId: null, timestamp: new Date().toISOString(), message: { role: "user" as const, content: "Exactly once", timestamp: 1 } };
  loseAck = true;
  await expect(session.getStorage().appendEntry(entry)).rejects.toThrow("acknowledgement");
  expect(await session.getEntries()).toEqual([]);
  loseAck = false;
  await session.getStorage().appendEntry(entry);
  expect(await session.getEntries()).toEqual([entry]);
  expect(await (await repo.open(await session.getMetadata())).getEntries()).toEqual([entry]);
});

it("does not resurrect externally deleted sessions or overwrite edited bytes", async () => {
  for (const action of ["delete", "edit"] as const) {
    const session = await repo.create({ cwd: root });
    await session.appendMessage({ role: "user", content: "Original", timestamp: 1 });
    const { path } = await session.getMetadata();
    if (action === "delete") unlinkSync(path);
    else writeFileSync(path, readFileSync(path, "utf8").replace("Original", "External"));
    await expect(session.appendMessage({ role: "user", content: "Stale", timestamp: 2 })).rejects.toThrow("changed");
    if (action === "delete") await expect(new LocalSessionFile().read(path)).rejects.toThrow("not found");
    else expect(readFileSync(path, "utf8")).toContain("External");
    expect(await session.getEntries()).toHaveLength(1);
  }
});

it("cancels a navigation waiting for the file lock without committing either record", async () => {
  const session = await repo.create({ cwd: root });
  const first = await session.appendMessage({ role: "user", content: "Original", timestamp: 1 });
  const second = await session.appendMessage({ role: "user", content: "Latest", timestamp: 2 });
  const meta = await session.getMetadata();
  const before = readFileSync(meta.path, "utf8");
  const release = lockSync(meta.path, { realpath: false, stale: 10_000, update: 2_000 });
  const controller = new AbortController();
  try {
    const pending = session.moveTo(first, { summary: "Cancelled summary" }, controller.signal);
    const outcome = pending.catch((error: unknown) => error);
    await Bun.sleep(30);
    controller.abort();
    expect(await outcome).toBeInstanceOf(Error);
    expect(await session.getLeafId()).toBe(second);
    expect(readFileSync(meta.path, "utf8")).toBe(before);
  } finally { release(); }
  await session.moveTo(first);
  expect(await session.getLeafId()).toBe(first);
});

it("keeps observer errors outside the commit acknowledgement and isolates event payloads", async () => {
  const session = await repo.create({ cwd: root });
  const events: string[] = [];
  const bad = subscribeFileEvents(event => { event.detail = "Mutated"; throw new Error("Observer failed"); });
  const rejected = subscribeFileEvents(async () => { throw new Error("Async observer failed"); });
  const good = subscribeFileEvents(event => { events.push(event.detail ?? ""); });
  try {
    await session.appendMessage({ role: "user", content: "Committed", timestamp: 1 });
    expect(events).toEqual(["session commit"]);
    expect(await (await repo.open(await session.getMetadata())).getEntries()).toEqual(await session.getEntries());
  } finally { bad(); rejected(); good(); }
});

it("rejects missing parents, invalid targets and truncated JSON without rewriting the file", async () => {
  for (const fragment of [
    '{"type":"message","id":"child","parentId":"missing","timestamp":"now"}',
    '{"type":"leaf","id":"leaf","parentId":null,"timestamp":"now","targetId":"missing"}',
    '{"type":"message","id":',
  ]) {
    const session = await repo.create({ cwd: root });
    const meta = await session.getMetadata();
    appendFileSync(meta.path, fragment + "\n");
    const before = readFileSync(meta.path, "utf8");
    await expect(repo.open(meta)).rejects.toThrow();
    expect(readFileSync(meta.path, "utf8")).toBe(before);
  }
});

it("returns isolated entries so callers cannot edit committed history in memory", async () => {
  const session = await repo.create({ cwd: root });
  const id = await session.appendMessage({ role: "user", content: "Original", timestamp: 1 });
  const entries = await session.getEntries();
  if (entries[0]?.type === "message" && entries[0].message.role === "user") entries[0].message.content = "Mutated externally";
  expect(await session.getEntry(id)).toMatchObject({ message: { content: "Original" } });
  expect((await session.buildContext()).messages[0]).toMatchObject({ content: "Original" });
});

it("forks a selected branch with its annotation references without mixing another branch into context", async () => {
  const session = await repo.create({ cwd: root });
  const first = await session.appendMessage({ role: "user", content: "Root research", timestamp: 1 });
  const other = await session.appendMessage({ role: "user", content: "Alternative research", timestamp: 2 });
  await session.moveTo(first);
  await session.appendMessage({ role: "user", content: "Selected research", timestamp: 3 });
  await session.appendLabel(other, "Alternative to revisit");
  const last = await session.appendMessage({ role: "user", content: "Continue selected", timestamp: 4 });
  const fork = await repo.fork(await session.getMetadata(), { cwd: root, entryId: last, position: "at" });
  expect(await fork.buildContext()).toEqual(await session.buildContext());
  expect(await fork.getEntry(other)).toMatchObject({ message: { content: "Alternative research" } });
  expect(await fork.getLabel(other)).toBe("Alternative to revisit");
  expect((await fork.buildContext()).messages).not.toContainEqual(expect.objectContaining({ content: "Alternative research" }));
});

it("rejects duplicated entry identities before traversing a damaged tree", async () => {
  const session = await repo.create({ cwd: root });
  await session.appendMessage({ role: "user", content: "Original", timestamp: 1 });
  const meta = await session.getMetadata();
  const entry = (await session.getEntries())[0]!;
  appendFileSync(meta.path, JSON.stringify({ ...entry, parentId: entry.id }) + "\n");
  await expect(repo.open(meta)).rejects.toThrow("entry");
});
