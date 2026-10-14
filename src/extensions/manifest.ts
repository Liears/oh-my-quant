import { EXTENSION_API_VERSION, type ExtensionManifest, type ExtensionResources } from "./types.ts";

export function validateExtensionManifest(manifest: ExtensionManifest): ExtensionManifest {
  const copy = structuredClone(manifest);
  if (typeof copy.id !== "string" || !/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(copy.id)) throw new Error("Invalid extension ID");
  if (typeof copy.version !== "string" || !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/.test(copy.version)) throw new Error("Invalid extension release version");
  if (copy.apiVersion !== EXTENSION_API_VERSION) throw new Error(`Unsupported extension API ${copy.apiVersion}; expected ${EXTENSION_API_VERSION}`);
  for (const kind of ["tools", "skills", "commands"] as const) {
    const names = copy[kind];
    if (!Array.isArray(names) || names.some(name => typeof name !== "string" || !/^[A-Za-z][A-Za-z0-9_.-]*$/.test(name))) throw new Error(`Invalid ${kind} declarations`);
    if (new Set(names).size !== names.length) throw new Error(`Duplicate ${kind} declarations`);
  }
  const capabilities = copy.capabilities ?? [];
  if (!Array.isArray(capabilities) || capabilities.some(name => typeof name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:>=-]*$/.test(name))) throw new Error("Invalid capabilities declarations");
  if (new Set(capabilities).size !== capabilities.length) throw new Error("Duplicate capabilities declarations");
  copy.capabilities = capabilities;
  return copy;
}

export function validateExtensionResources(manifest: ExtensionManifest, resources: ExtensionResources): void {
  for (const kind of ["tools", "skills", "commands"] as const) {
    if (!Array.isArray(resources[kind])) throw new Error(`Missing ${kind} resources`);
    const actual = resources[kind].map(resource => resource.name).sort();
    if (JSON.stringify(actual) !== JSON.stringify([...manifest[kind]].sort())) throw new Error(`Declared ${kind} do not match activated resources`);
  }
  const capabilities = resources.capabilities ?? [];
  if (!Array.isArray(capabilities)) throw new Error("Invalid capabilities resources");
  const declared = [...(manifest.capabilities ?? [])].sort();
  const actual = capabilities.map(capability => capability.requirement).sort();
  if (JSON.stringify(actual) !== JSON.stringify(declared)) throw new Error("Declared capabilities do not match activated resources");
  for (const tool of resources.tools) {
    if (typeof tool.execute !== "function" || !tool.parameters || Reflect.get(tool.parameters, "type") !== "object" || typeof tool.description !== "string" || typeof tool.label !== "string") throw new Error(`Invalid tool resource: ${tool.name}`);
  }
  for (const skill of resources.skills) {
    if (typeof skill.content !== "string" || !skill.description?.trim() || !skill.filePath?.trim()) throw new Error(`Invalid skill resource: ${skill.name}`);
  }
  for (const command of resources.commands) if (typeof command.execute !== "function" || !command.description?.trim()) throw new Error(`Invalid command resource: ${command.name}`);
  const statuses = new Set(["available", "missing", "unverified", "input-required"]);
  for (const capability of capabilities) {
    if (!capability || typeof capability.requirement !== "string" || !statuses.has(capability.status) || typeof capability.reason !== "string" || !capability.reason.trim())
      throw new Error(`Invalid capability resource: ${capability?.requirement ?? "(missing requirement)"}`);
    if (capability.requiresTools !== undefined && (!Array.isArray(capability.requiresTools)
      || capability.requiresTools.some(name => typeof name !== "string" || !manifest.tools.includes(name))
      || new Set(capability.requiresTools).size !== capability.requiresTools.length))
      throw new Error(`Invalid capability tool bindings: ${capability.requirement}`);
  }
  if (resources.dispose !== undefined && typeof resources.dispose !== "function") throw new Error("Invalid extension disposer");
}
