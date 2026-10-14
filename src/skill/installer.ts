import { runSkillGit } from "./git.ts";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

export interface SkillInstallResult {
  success: boolean;
  message: string;
  revision?: string;
  source?: string;
}

export type SkillGit = (args: string[], timeout: number, signal?: AbortSignal) => string | Promise<string>;
const activeInstalls = new Set<string>();
export interface SkillRevisionPin { revision: string; requiredFiles: readonly string[] }

/** The injected command port changes transport in tests; transaction decisions remain here. */
export async function installSkillRepository(root: string, repo: string, git: SkillGit = runSkillGit, signal?: AbortSignal, pin?: SkillRevisionPin): Promise<SkillInstallResult> {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(repo)) {
    return { success: false, message: "Use a GitHub repo in owner/repo format, for example: /skill install LLMQuant/skills" };
  }
  if (pin && (!/^[a-f0-9]{40}$/.test(pin.revision) || pin.requiredFiles.some(file => !/^[A-Za-z0-9_-][A-Za-z0-9_.-]*(?:\/[A-Za-z0-9_.-]+)*$/.test(file) || file.split("/").some(part => part === "." || part === "..")))) {
    return { success: false, message: "Invalid pinned revision or required file path." };
  }
  const target = resolve(root, repo.replace("/", "-"));
  const source = `https://github.com/${repo}.git`;
  const lock = process.platform === "win32" ? target.toLowerCase() : target;
  if (activeInstalls.has(lock)) return { success: false, message: `Installation already running for ${repo}. Wait and retry.` };
  activeInstalls.add(lock);
  const command = async (args: string[], timeout: number) => {
    signal?.throwIfAborted();
    const output = await git(args, timeout, signal);
    signal?.throwIfAborted();
    return output;
  };
  let staging: string | undefined;
  try {
    signal?.throwIfAborted();
    const updating = existsSync(target);
    if (updating) {
      if (lstatSync(target).isSymbolicLink() || !lstatSync(target).isDirectory()) throw new Error("Install location must be a repository directory, not a link or file.");
      const top = await command(["-C", target, "rev-parse", "--show-toplevel"], 10_000);
      const topIdentity = statSync(top, { bigint: true });
      const targetIdentity = statSync(target, { bigint: true });
      if (topIdentity.dev !== targetIdentity.dev || topIdentity.ino !== targetIdentity.ino) throw new Error("Install location is not its own Git repository.");
      const origin = await command(["-C", target, "remote", "get-url", "origin"], 10_000);
      if (origin.replace(/\.git$/, "").toLowerCase() !== source.replace(/\.git$/, "").toLowerCase()) {
        throw new Error("Existing origin differs from the requested repository; the installation was preserved.");
      }
      if (await command(["-C", target, "status", "--porcelain", "--untracked-files=all", "--ignored=matching"], 10_000)) {
        throw new Error("Local changes or untracked files (including ignored files) exist. Save them before retrying; no files were removed.");
      }
      if (pin) {
        const current = await command(["-C", target, "rev-parse", "--verify", "HEAD"], 10_000);
        if (current !== pin.revision) {
          await command(["-C", target, "fetch", "origin", pin.revision], 60_000);
          for (const file of pin.requiredFiles) {
            if (await command(["-C", target, "cat-file", "-t", `${pin.revision}:${file}`], 10_000) !== "blob") throw new Error(`Pinned skill entry is missing: ${file}`);
          }
          await command(["-C", target, "merge", "--ff-only", pin.revision], 30_000);
        }
      } else await command(["-C", target, "pull", "--ff-only", "--no-rebase"], 30_000);
    } else {
      mkdirSync(root, { recursive: true });
      staging = mkdtempSync(join(resolve(root), ".install-"));
      if (pin) {
        await command(["init", staging], 10_000);
        await command(["-C", staging, "remote", "add", "origin", source], 10_000);
        await command(["-C", staging, "fetch", "--depth", "1", "origin", pin.revision], 60_000);
        await command(["-C", staging, "checkout", "--detach", pin.revision], 30_000);
      } else await command(["clone", "--depth", "1", "--filter=blob:none", source, staging], 60_000);
    }
    const revision = await command(["-C", staging ?? target, "rev-parse", "--verify", "HEAD"], 10_000);
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(revision)) throw new Error("Repository has no valid commit revision.");
    if (pin && revision !== pin.revision) throw new Error("Current history cannot fast-forward to the pinned revision; no reset was performed.");
    for (const file of pin?.requiredFiles ?? []) {
      const path = join(staging ?? target, file);
      if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`Pinned skill entry is missing: ${file}`);
    }
    if (staging) {
      if (existsSync(target)) throw new Error("Another installation created the destination. Retry to inspect it.");
      renameSync(staging, target);
      staging = undefined;
    }
    return { success: true, source, revision,
      message: `${updating ? "Updated" : "Installed"} ${repo}\nLocation  ${target}\nRevision  ${revision}\nNext      Run /skill after the current response finishes to discover installed skills. Runtime dependencies are checked separately.` };
  } catch (error) {
    return { success: false, message: `Could not install or update ${repo}.\nLocation: ${target}\nCause: ${error instanceof Error ? error.message : String(error)}\nExisting installation preserved. Check local changes and GitHub access, then retry /skill install ${repo}.` };
  } finally {
    activeInstalls.delete(lock);
    if (staging && existsSync(staging)) {
      const within = relative(realpathSync(root), realpathSync(staging));
      if (!within.startsWith(".install-") || within.includes(sep) || resolve(root) === resolve(staging)) {
        throw new Error("Refusing to clean a staging directory outside the installation root.");
      }
      rmSync(staging, { recursive: true, force: true });
    }
  }
}
