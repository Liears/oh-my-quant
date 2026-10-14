import { parse } from "yaml";
import { type ExecutionEnv, type FileInfo, type Result, toError } from "./types.ts";

/** Internal filesystem diagnostics shared by skill and prompt-template loaders. */
interface ResourceDiagnostic {
	type: "warning";
	code: "file_info_failed" | "read_failed" | "parse_failed";
	message: string;
	path: string;
}

export async function resolveKind(
	env: ExecutionEnv,
	info: FileInfo,
	diagnostics: { push(diagnostic: ResourceDiagnostic): void },
): Promise<"file" | "directory" | undefined> {
	if (info.kind === "file" || info.kind === "directory") return info.kind;
	const canonicalPath = await env.canonicalPath(info.path);
	if (!canonicalPath.ok) {
		if (canonicalPath.error.code !== "not_found") {
			diagnostics.push({
				type: "warning",
				code: "file_info_failed",
				message: canonicalPath.error.message,
				path: info.path,
			});
		}
		return undefined;
	}
	const target = await env.fileInfo(canonicalPath.value);
	if (!target.ok) {
		if (target.error.code !== "not_found") {
			diagnostics.push({
				type: "warning",
				code: "file_info_failed",
				message: target.error.message,
				path: info.path,
			});
		}
		return undefined;
	}
	return target.value.kind === "file" || target.value.kind === "directory" ? target.value.kind : undefined;
}

export function basenameEnvPath(path: string): string {
	const normalized = path.replace(/\/+$/, "");
	const slashIndex = normalized.lastIndexOf("/");
	return slashIndex === -1 ? normalized : normalized.slice(slashIndex + 1);
}

/** Read and decode Markdown without deciding discovery rules or metadata validity. */
export async function readMarkdownResource(
	env: ExecutionEnv,
	path: string,
): Promise<Result<{ frontmatter: Record<string, unknown>; body: string }, ResourceDiagnostic>> {
	const content = await env.readTextFile(path);
	if (!content.ok) return { ok: false, error: { type: "warning", code: "read_failed", message: content.error.message, path } };
	const parsed = parseFrontmatter(content.value);
	return parsed.ok ? parsed : { ok: false, error: { type: "warning", code: "parse_failed", message: parsed.error.message, path } };
}

function parseFrontmatter(
	content: string,
): Result<{ frontmatter: Record<string, unknown>; body: string }, Error> {
	try {
		const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
		if (!normalized.startsWith("---")) return { ok: true, value: { frontmatter: {}, body: normalized } };
		const endIndex = normalized.indexOf("\n---", 3);
		if (endIndex === -1) return { ok: true, value: { frontmatter: {}, body: normalized } };
		const yamlString = normalized.slice(4, endIndex);
		const body = normalized.slice(endIndex + 4).trim();
		return { ok: true, value: { frontmatter: (parse(yamlString) ?? {}) as Record<string, unknown>, body } };
	} catch (error) {
		return { ok: false, error: toError(error) };
	}
}
