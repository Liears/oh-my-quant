import { basename, resolve } from "node:path";
import { bashTool } from "../../../tools/bash-tool.ts";

export interface ChartReferenceRead {
  resource: string;
  allowed: boolean;
  fullRead: boolean;
  succeeded: boolean;
}

/** Manual validation only: a finite command set delegates to the production shell tool. */
export function createChartReferenceReader(paths: string[], cwd: string, calls: ChartReferenceRead[], shell = bashTool): typeof bashTool {
  const commands = new Map<string, { resource: string; fullRead: boolean }>();
  for (const path of paths) {
    const absolute = resolve(path);
    if (/["'`$\r\n]/u.test(absolute)) throw new Error("Unsupported reference path quoting");
    for (const spelling of new Set([absolute, absolute.replaceAll("\\", "/")])) {
      for (const quote of ["'", '"']) {
        for (const literal of ["", "-LiteralPath "]) {
          for (const flags of ["", " -Raw", " -Encoding utf8", " -Raw -Encoding utf8", " -Encoding utf8 -Raw"]) {
            const command = `Get-Content ${literal}${quote}${spelling}${quote}${flags}`;
            commands.set(command.toLowerCase(), { resource: basename(path), fullRead: true });
            if (!flags.includes("-Raw")) {
              for (const count of [60, 120]) commands.set(`${command} | Select-Object -First ${count}`.toLowerCase(), { resource: basename(path), fullRead: false });
            }
          }
        }
      }
    }
  }
  return {
    ...shell,
    description: "Production PowerShell tool restricted to the pinned guidance paths. Read using Get-Content -LiteralPath 'ABSOLUTE_PATH' -Raw -Encoding utf8. No other commands, scripts, network or writes are permitted.",
    async execute(id, args, signal, onUpdate) {
      const matched = commands.get(args.command.trim().toLowerCase());
      const allowed = matched !== undefined && (args.workdir === undefined || resolve(args.workdir) === resolve(cwd))
        && (args.timeout_ms === undefined || Number.isFinite(args.timeout_ms) && args.timeout_ms > 0 && args.timeout_ms <= 30000);
      const call: ChartReferenceRead = { resource: matched?.resource ?? "rejected", allowed, fullRead: matched?.fullRead ?? false, succeeded: false };
      calls.push(call);
      if (!allowed) throw new Error("Only exact Get-Content commands of pinned guidance paths are permitted in the isolated workdir.");
      const result = await shell.execute(id, { ...args, workdir: cwd, timeout_ms: args.timeout_ms ?? 30000 }, signal, onUpdate);
      call.succeeded = true;
      return result;
    },
  };
}
