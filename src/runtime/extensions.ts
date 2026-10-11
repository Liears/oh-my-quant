import { ExtensionHost, type ExtensionDefinition } from "../extensions/index.ts";
import { loadSettings, saveSettings } from "../storage/index.ts";
import type { OhQuantSettings } from "../types/config.ts";
import type { CommandResult, ExtensionAction } from "../types/commands.ts";
import { builtinQuantExtension } from "./builtin-extension.ts";

interface ExtensionRuntimeOptions {
  cwd?: string;
  definitions?: readonly ExtensionDefinition[];
  readSettings?: () => OhQuantSettings;
  saveSettings?: (settings: OhQuantSettings) => void;
}

/** Application-owned registry and durable choices; extension business code receives neither settings nor UI. */
export class RuntimeExtensions {
  readonly host: ExtensionHost;
  private readonly definitions: Map<string, ExtensionDefinition>;
  private readonly readSettings: () => OhQuantSettings;
  private readonly saveSettings: (settings: OhQuantSettings) => void;
  private readonly lifetime = new AbortController();
  private readonly failures = new Map<string, string>();
  private initialization?: Promise<void>;
  private operations: Promise<unknown> = Promise.resolve();
  private closing?: Promise<void>;

  constructor(options: ExtensionRuntimeOptions = {}) {
    this.host = new ExtensionHost({ cwd: options.cwd ?? process.cwd(), reserved: { tools: ["research_task"] } });
    this.readSettings = options.readSettings ?? loadSettings;
    this.saveSettings = options.saveSettings ?? saveSettings;
    this.definitions = new Map();
    for (const definition of options.definitions ?? [builtinQuantExtension]) {
      const manifest = structuredClone(definition.manifest);
      if (this.definitions.has(manifest.id)) throw new Error(`Duplicate extension ID: ${manifest.id}`);
      this.definitions.set(manifest.id, { manifest, activate: definition.activate });
    }
  }

  start(): Promise<void> {
    this.initialization ??= (async () => {
      this.lifetime.signal.throwIfAborted();
      const disabled = new Set(this.readSettings().disabledExtensions ?? []);
      for (const [id, definition] of this.definitions) {
        this.lifetime.signal.throwIfAborted();
        if (disabled.has(id)) continue;
        try { await this.host.load(definition, this.lifetime.signal); }
        catch (error) { this.failures.set(id, error instanceof Error ? error.message : String(error)); }
      }
      this.lifetime.signal.throwIfAborted();
    })();
    return this.initialization;
  }

  get startupErrors(): string[] { return [...this.failures].map(([id, message]) => `${id}: ${message}`); }

  manage(action: ExtensionAction, id?: string, signal?: AbortSignal): Promise<CommandResult> {
    const operation = this.operations.catch(() => {}).then(async (): Promise<CommandResult> => {
      const combined = AbortSignal.any([this.lifetime.signal, ...(signal ? [signal] : [])]);
      try {
        combined.throwIfAborted();
        await this.start();
        combined.throwIfAborted();
        if (action !== "list") {
          const definition = id ? this.definitions.get(id) : undefined;
          if (!definition) throw new Error(`Unknown extension: ${id ?? "(missing ID)"}. Use /config --extensions list.`);
          const settings = this.readSettings();
          const wasEnabled = this.host.list().some(entry => entry.manifest.id === id && entry.enabled);
          if (action === "reload") {
            if (!wasEnabled) throw new Error("Enable the extension before reloading it.");
            await this.host.reload(definition, combined);
          } else {
            const enabled = action === "enable";
            if (enabled !== wasEnabled) {
              if (enabled) {
                if (this.host.list().some(entry => entry.manifest.id === id)) await this.host.enable(id!, combined);
                else await this.host.load(definition, combined);
              } else await this.host.disable(id!);
            }
            try {
              combined.throwIfAborted();
              const disabled = new Set(settings.disabledExtensions ?? []);
              if (enabled) disabled.delete(id!); else disabled.add(id!);
              settings.disabledExtensions = [...disabled];
              this.saveSettings(settings);
            } catch (error) {
              if (enabled !== wasEnabled && !this.lifetime.signal.aborted) {
                try { if (wasEnabled) await this.host.enable(id!); else await this.host.disable(id!); }
                catch (rollback) { throw new Error(`Settings were not saved: ${String(error)}. Extension state could not be restored: ${String(rollback)}. Restart after reviewing settings.`); }
              }
              throw error;
            }
          }
          this.failures.delete(id!);
        }
        const loaded = this.host.list();
        const disabled = this.readSettings().disabledExtensions ?? [];
        const extensions = [...this.definitions].map(([extensionId, definition]) => {
          const entry = loaded.find(item => item.manifest.id === extensionId);
          return { manifest: structuredClone(definition.manifest), enabled: entry?.enabled ?? false,
            configuredEnabled: !disabled.includes(extensionId),
            diagnostics: [...this.host.getDiagnostics(extensionId), ...(this.failures.has(extensionId) ? [this.failures.get(extensionId)!] : [])] };
        });
        const unavailable = disabled.filter(extensionId => !this.definitions.has(extensionId));
        return { success: true, message: ["Extensions", ...extensions.map(entry =>
          `  ${entry.manifest.id} ${entry.manifest.version} · ${entry.enabled ? "enabled" : entry.configuredEnabled ? "failed" : "disabled"} · ${entry.manifest.tools.length} tools / ${entry.manifest.skills.length} skills / ${entry.manifest.commands.length} commands / ${entry.manifest.capabilities?.length ?? 0} capabilities${entry.diagnostics.length ? `\n    ${entry.diagnostics.join("\n    ")}` : ""}`),
          ...unavailable.map(extensionId => `  ${extensionId} · unavailable in this build · disabled choice retained`),
          "Use /config --extensions enable|disable|reload <id>. Choices apply to this runtime and future starts."] .join("\n"),
          data: { extensions, unavailable }, renderAs: "text" };
      } catch (error) { return { success: false, message: `Extension operation failed: ${error instanceof Error ? error.message : String(error)}` }; }
    });
    this.operations = operation;
    return operation;
  }

  dispose(): Promise<void> {
    this.lifetime.abort(new Error("Extension runtime stopped"));
    this.closing ??= (async () => {
      await this.host.dispose();
      await Promise.allSettled([this.initialization, this.operations]);
    })();
    return this.closing;
  }
}
