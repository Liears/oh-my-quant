import { describe, expect, it } from "bun:test";
import { NodeExecutionEnv } from "../src/session-runtime/node.ts";
import { loadPromptTemplates, loadSourcedPromptTemplates } from "../src/session-runtime/harness/prompt-templates.ts";
import { FileError, type FileErrorCode, type FileInfo } from "../src/session-runtime/harness/types.ts";

// A filesystem port fixture keeps link/error cases independent of OS symlink permissions.
function environment(files: Record<string, string>, directories: string[] = ["/resources"]) {
  const env = new NodeExecutionEnv({ cwd: "/resources" });
  const info = (path: string): FileInfo => ({
    path, name: path.split("/").at(-1)!, kind: directories.includes(path) ? "directory" : "file",
    size: 0, mtimeMs: 0,
  });
  env.fileInfo = async path => path in files || directories.includes(path)
    ? { ok: true, value: info(path) }
    : { ok: false, error: new FileError("not_found", "missing", path) };
  env.listDir = async path => ({ ok: true, value: [...directories, ...Object.keys(files)]
    .filter(entry => entry.slice(0, entry.lastIndexOf("/")) === path).map(info) });
  env.readTextFile = async path => path in files
    ? { ok: true, value: files[path]! }
    : { ok: false, error: new FileError("not_found", "missing", path) };
  env.canonicalPath = async path => ({ ok: true, value: path });
  return env;
}

describe("Markdown resource loading", () => {
  for (const newline of ["\n", "\r\n", "\r"]) {
    it(`preserves metadata and body with ${JSON.stringify(newline)} line endings`, async () => {
      const env = environment({ "/resources/SKILL.md": ["---", "name: resources", "description: Shared instructions",
        "disable-model-invocation: true", "---", "", "Use $1", ""].join(newline) });
      const prompt = await loadPromptTemplates(env, "/resources");
      expect(prompt.diagnostics).toEqual([]);
      expect(prompt.promptTemplates).toEqual([{ name: "SKILL", description: "Shared instructions", content: "Use $1" }]);
    });
  }

  for (const content of ["Plain body\r\nSecond line", "---\ndescription: unfinished", "---\n---\nBody"]) {
    it(`keeps template fallback for ${JSON.stringify(content)}`, async () => {
      const env = environment({ "/resources/SKILL.md": content });
      const prompt = await loadPromptTemplates(env, "/resources");
      const body = content === "---\n---\nBody" ? "Body" : content.replace(/\r\n/g, "\n");
      expect(prompt.promptTemplates).toEqual([{ name: "SKILL", description: body.split("\n")[0], content: body }]);
      expect(prompt.diagnostics).toEqual([]);
    });
  }

  it("preserves parse and read failure codes, addressed paths and source identities", async () => {
    for (const failure of ["parse_failed", "read_failed"] as const) {
      const env = environment({ "/resources/SKILL.md": "---\ndescription: [\n---\nbody" });
      if (failure === "read_failed") env.readTextFile = async path => ({ ok: false, error: new FileError("permission_denied", "denied", path) });
      const source = { scope: "project" };
      const prompts = await loadSourcedPromptTemplates(env, [{ path: "/resources/SKILL.md", source }]);
      expect(prompts.promptTemplates).toEqual([]);
      for (const result of [prompts]) {
        expect(result.diagnostics).toHaveLength(1);
        expect(result.diagnostics[0]).toMatchObject({ type: "warning", code: failure, path: "/resources/SKILL.md" });
        expect(result.diagnostics[0]!.source).toBe(source);
      }
    }
  });

  for (const stage of ["canonical", "target"] as const) {
    for (const code of ["not_found", "permission_denied"] satisfies FileErrorCode[]) {
      it(`${stage} link failure ${code} retains skip/diagnostic behavior`, async () => {
        const env = environment({});
        env.fileInfo = async path => path === "/link"
          ? { ok: true, value: { path, name: "link", kind: "symlink", size: 0, mtimeMs: 0 } }
          : { ok: false, error: new FileError(code, "link failed", path) };
        env.canonicalPath = async path => stage === "canonical"
          ? { ok: false, error: new FileError(code, "link failed", path) }
          : { ok: true, value: "/target" };
        const prompts = await loadPromptTemplates(env, "/link");
        expect(prompts.promptTemplates).toEqual([]);
        for (const result of [prompts]) expect(result.diagnostics).toEqual(code === "not_found" ? []
          : [{ type: "warning", code: "file_info_failed", message: "link failed", path: "/link" }]);
      });
    }
  }

  it("resolves linked resources without changing their addressed identity", async () => {
    const env = environment({ "/resources/SKILL.md": "---\nname: resources\ndescription: linked\n---\nbody" });
    const fileInfo = env.fileInfo;
    env.fileInfo = async path => path === "/resources"
      ? { ok: true, value: { path, name: "resources", kind: "symlink", size: 0, mtimeMs: 0 } }
      : path === "/target" ? { ok: true, value: { path, name: "target", kind: "directory", size: 0, mtimeMs: 0 } } : fileInfo(path);
    env.canonicalPath = async () => ({ ok: true, value: "/target" });
    expect((await loadPromptTemplates(env, "/resources")).promptTemplates[0]!.description).toBe("linked");
  });

  it("retains shallow template discovery", async () => {
    const content = (name: string) => `---\nname: ${name}\ndescription: ${name}\n---\nbody`;
    const env = environment({
      "/resources/.gitignore": "ignored/", "/resources/root.md": content("resources"),
      "/resources/nested/SKILL.md": content("nested"), "/resources/ignored/SKILL.md": content("ignored"),
    }, ["/resources", "/resources/nested", "/resources/ignored"]);
    expect((await loadPromptTemplates(env, "/resources")).promptTemplates.map(item => item.name)).toEqual(["root"]);
  });
});
