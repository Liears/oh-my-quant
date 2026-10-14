import { EXTENSION_API_VERSION, type ExtensionDefinition, type ExtensionManifest, type ExtensionResourceKind, type ExtensionResources, type ExtensionSnapshot, type ExtensionStatus } from "./types.ts";
import { validateExtensionManifest, validateExtensionResources } from "./manifest.ts";

interface Instance {
  manifest: ExtensionManifest;
  activate: ExtensionDefinition["activate"];
  controller: AbortController;
  resources: ExtensionResources;
  active: Set<Promise<unknown>>;
  live: boolean;
  retired: boolean;
}

/** Explicit module host; lifecycle mutations serialize, tool/command invocations remain independent. */
export class ExtensionHost {
  private readonly entries = new Map<string, Instance>();
  private readonly diagnostics = new Map<string, string[]>();
  private revision = 0;
  private mutations: Promise<unknown> = Promise.resolve();
  private readonly lifetime = new AbortController();
  private readonly options: { cwd: string; reserved?: Partial<Record<ExtensionResourceKind, readonly string[]>>; activationTimeoutMs?: number };

  constructor(options: { cwd: string; reserved?: Partial<Record<ExtensionResourceKind, readonly string[]>>; activationTimeoutMs?: number }) {
    if (options.activationTimeoutMs !== undefined && (!Number.isSafeInteger(options.activationTimeoutMs) || options.activationTimeoutMs < 1)) throw new Error("Invalid extension activation timeout");
    this.options = structuredClone(options);
  }

  list(): ExtensionStatus[] {
    return [...this.entries.values()].map(entry => ({ manifest: structuredClone(entry.manifest), enabled: entry.live, diagnostics: [...(this.diagnostics.get(entry.manifest.id) ?? [])] }));
  }

  getDiagnostics(id: string): string[] { return [...(this.diagnostics.get(id) ?? [])]; }

  reserve(names: Partial<Record<ExtensionResourceKind, readonly string[]>>): Promise<void> {
    const snapshot = structuredClone(names);
    return this.enqueue(async () => {
      this.lifetime.signal.throwIfAborted();
      const reserved = structuredClone(this.options.reserved ?? {});
      for (const kind of ["tools", "skills", "commands", "capabilities"] as const) {
        const additions = snapshot[kind] ?? [];
        for (const entry of this.entries.values()) {
          if (entry.live && (entry.manifest[kind] ?? []).some(name => additions.includes(name))) throw new Error(`Cannot reserve occupied ${kind} names`);
        }
        reserved[kind] = [...new Set([...(reserved[kind] ?? []), ...additions])];
      }
      this.options.reserved = reserved;
    });
  }

  snapshot(): ExtensionSnapshot {
    const entries = [...this.entries.values()].filter(entry => entry.live);
    return { revision: String(this.revision),
      tools: entries.flatMap(entry => entry.resources.tools.map(tool => ({ ...tool, parameters: structuredClone(tool.parameters) }))),
      skills: entries.flatMap(entry => entry.resources.skills.map(skill => ({ ...structuredClone(skill), extensionId: entry.manifest.id }))),
      commands: entries.flatMap(entry => entry.resources.commands.map(command => ({ name: command.name, description: command.description, extensionId: entry.manifest.id }))),
      capabilities: entries.flatMap(entry => (entry.resources.capabilities ?? []).map(capability => ({ ...structuredClone(capability), extensionId: entry.manifest.id }))),
    };
  }

  async load(definition: ExtensionDefinition, signal?: AbortSignal): Promise<void> {
    const manifest = validateExtensionManifest(definition.manifest), activate = definition.activate;
    return this.enqueue(async () => {
      if (this.entries.has(manifest.id)) throw new Error(`Extension already loaded: ${manifest.id}`);
      const candidate = await this.prepare(manifest, activate, signal);
      await this.publish(candidate, signal);
    });
  }

  async reload(definition: ExtensionDefinition, signal?: AbortSignal): Promise<void> {
    const manifest = validateExtensionManifest(definition.manifest), activate = definition.activate;
    return this.enqueue(async () => {
      const previous = this.entries.get(manifest.id);
      if (!previous) throw new Error(`Unknown extension: ${manifest.id}`);
      const candidate = await this.prepare(manifest, activate, signal);
      await this.publish(candidate, signal);
      await this.retire(previous);
    });
  }

  disable(id: string): Promise<void> {
    return this.enqueue(async () => {
      const entry = this.entries.get(id);
      if (!entry) throw new Error(`Unknown extension: ${id}`);
      if (!entry.live) return;
      entry.live = false; this.revision++;
      await this.retire(entry);
    });
  }

  enable(id: string, signal?: AbortSignal): Promise<void> {
    return this.enqueue(async () => {
      const entry = this.entries.get(id);
      if (!entry) throw new Error(`Unknown extension: ${id}`);
      if (entry.live) return;
      const candidate = await this.prepare(entry.manifest, entry.activate, signal);
      await this.publish(candidate, signal);
    });
  }

  async executeCommand(name: string, args: string[] = [], signal?: AbortSignal): Promise<unknown> {
    for (const entry of this.entries.values()) {
      const command = entry.live ? entry.resources.commands.find(command => command.name === name) : undefined;
      if (command) return command.execute([...args], signal ?? new AbortController().signal);
    }
    throw new Error(`Unknown extension command: ${name}`);
  }

  dispose(): Promise<void> {
    this.lifetime.abort(new Error("Extension host disposed"));
    return this.enqueue(async () => {
      const active = [...this.entries.values()].filter(entry => entry.live);
      for (const entry of active) { entry.live = false; entry.controller.abort(new Error("Extension host disposed")); }
      if (active.length) this.revision++;
      await Promise.all(active.map(entry => this.retire(entry)));
    });
  }

  private enqueue(action: () => Promise<void>): Promise<void> {
    const operation = this.mutations.catch(() => {}).then(action);
    this.mutations = operation;
    return operation;
  }

  private async prepare(manifest: ExtensionManifest, activate: ExtensionDefinition["activate"], signal?: AbortSignal): Promise<Instance> {
    signal?.throwIfAborted();
    this.lifetime.signal.throwIfAborted();
    for (const kind of ["tools", "skills", "commands", "capabilities"] as const) {
      const occupied = new Set([...(this.options.reserved?.[kind] ?? []), ...[...this.entries.values()].filter(entry => entry.live && entry.manifest.id !== manifest.id).flatMap(entry => entry.manifest[kind] ?? [])]);
      const conflict = (manifest[kind] ?? []).find(name => occupied.has(name));
      if (conflict) throw new Error(`Extension ${kind} conflict: ${conflict}`);
    }
    const controller = new AbortController();
    const caller = signal ? AbortSignal.any([signal, this.lifetime.signal]) : this.lifetime.signal;
    const abort = () => controller.abort(caller.reason);
    caller.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => controller.abort(new Error("Extension activation timed out")), this.options.activationTimeoutMs ?? 10_000);
    let resources: ExtensionResources | undefined;
    let onAbort!: () => void;
    try {
      resources = await Promise.race([
        Promise.resolve().then(() => activate({ apiVersion: EXTENSION_API_VERSION, cwd: this.options.cwd, signal: controller.signal, report: message => this.report(manifest.id, message) })).then(async result => {
          if (controller.signal.aborted) { await this.cleanup(manifest.id, result); controller.signal.throwIfAborted(); }
          return result;
        }),
        new Promise<never>((_resolve, reject) => {
          onAbort = () => reject(controller.signal.reason);
          if (controller.signal.aborted) onAbort(); else controller.signal.addEventListener("abort", onAbort, { once: true });
        }),
      ]);
      controller.signal.throwIfAborted();
      validateExtensionResources(manifest, resources);
      const instance: Instance = { manifest: structuredClone(manifest), activate, controller, resources, active: new Set(), live: true, retired: false };
      const original = resources;
      instance.resources = {
        tools: original.tools.map(tool => { const execute = tool.execute.bind(tool); return { ...tool, parameters: structuredClone(tool.parameters), execute: (...args: Parameters<typeof tool.execute>) => this.invoke(instance, args[2], async combined => {
          const result = await execute(args[0], args[1], combined, update => { if (!combined.aborted) args[3]?.(update); });
          combined.throwIfAborted(); return result;
        }) }; }),
        skills: structuredClone(original.skills),
        commands: original.commands.map(command => { const execute = command.execute.bind(command); return { ...command, execute: (args: string[], signal: AbortSignal) => this.invoke(instance, signal, combined => execute([...args], combined)) }; }),
        capabilities: structuredClone(original.capabilities ?? []),
        dispose: original.dispose?.bind(original),
      };
      return instance;
    } catch (error) {
      controller.abort(error);
      if (resources) await this.cleanup(manifest.id, resources);
      this.report(manifest.id, `Activation failed: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    } finally {
      clearTimeout(timer); caller.removeEventListener("abort", abort); controller.signal.removeEventListener("abort", onAbort);
    }
  }

  private async invoke<T>(instance: Instance, signal: AbortSignal | undefined, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (!instance.live) throw new Error(`Extension is no longer active: ${instance.manifest.id}`);
    const combined = AbortSignal.any([...(signal ? [signal] : []), instance.controller.signal, this.lifetime.signal]);
    combined.throwIfAborted();
    const operation = Promise.resolve().then(() => { combined.throwIfAborted(); return run(combined); });
    instance.active.add(operation);
    try { const result = await operation; combined.throwIfAborted(); return result; }
    finally { instance.active.delete(operation); }
  }

  private async publish(candidate: Instance, signal?: AbortSignal): Promise<void> {
    try { signal?.throwIfAborted(); this.lifetime.signal.throwIfAborted(); }
    catch (error) { await this.retire(candidate); throw error; }
    this.entries.set(candidate.manifest.id, candidate); this.revision++;
  }

  private async retire(instance: Instance): Promise<void> {
    if (instance.retired) return;
    instance.retired = true;
    instance.live = false; instance.controller.abort(new Error(`Extension disabled or replaced: ${instance.manifest.id}`));
    await Promise.allSettled([...instance.active]);
    await this.cleanup(instance.manifest.id, instance.resources);
  }

  private async cleanup(id: string, resources: ExtensionResources): Promise<void> {
    try { await resources.dispose?.(); }
    catch (error) { this.report(id, `Cleanup failed: ${error instanceof Error ? error.message : String(error)}`); }
  }

  private report(id: string, message: string): void {
    const messages = this.diagnostics.get(id) ?? [];
    this.diagnostics.set(id, [...messages, message].slice(-20));
  }
}
