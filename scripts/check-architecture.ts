import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

interface BoundaryRule {
  id: string;
  from: string[];
  blockedTo: string[];
  reason: string;
}

interface Violation {
  key: string;
  rule: string;
  from: string;
  to: string;
  specifier: string;
  reason: string;
}

const ROOT = resolve(import.meta.dir, "..");
const SRC_ROOT = join(ROOT, "src");
const BASELINE_PATH = join(ROOT, "scripts", "architecture-boundary-baseline.json");

const RULES: BoundaryRule[] = [
  {
    id: "types-are-shared-contracts",
    from: ["types"],
    blockedTo: ["agent", "app", "artifact", "cli", "quant", "skill", "source", "storage", "tools", "tui"],
    reason: "src/types must stay provider/UI/runtime independent.",
  },
  {
    id: "storage-owns-persistence-only",
    from: ["storage"],
    blockedTo: ["agent", "app", "artifact", "cli", "quant", "skill", "source", "tools", "tui"],
    reason: "storage should expose persistence APIs without depending on higher-level modules.",
  },
  {
    id: "quant-core-is-pure",
    from: ["quant"],
    blockedTo: ["agent", "app", "artifact", "cli", "skill", "source", "storage", "tools", "tui"],
    reason: "quant core should stay pure and receive data/persistence through adapters.",
  },
  {
    id: "source-provider-boundary",
    from: ["source"],
    blockedTo: ["agent", "app", "artifact", "cli", "quant", "skill", "tools", "tui"],
    reason: "source providers should not depend on UI, tools, agent, or quant workflows.",
  },
  {
    id: "tui-is-render-adapter",
    from: ["tui"],
    blockedTo: ["agent", "cli", "quant", "skill", "source", "storage", "tools"],
    reason: "tui should consume runtime view models instead of calling business modules directly.",
  },
  {
    id: "skill-does-not-depend-on-cli",
    from: ["skill"],
    blockedTo: ["cli", "tui", "tools"],
    reason: "skill commands should use shared contracts, not CLI/TUI implementations.",
  },
  {
    id: "tools-do-not-depend-on-ui",
    from: ["tools"],
    blockedTo: ["app", "cli", "tui"],
    reason: "tools should remain agent adapters and not depend on UI or CLI layers.",
  },
  {
    id: "cli-does-not-depend-on-tui",
    from: ["cli"],
    blockedTo: ["app", "tui"],
    reason: "slash command handlers should not depend on the interactive renderer.",
  },
];

const WRITE_BASELINE = process.argv.includes("--write-baseline");

function main(): void {
  const violations = findViolations();
  const baseline = loadBaseline();
  if (WRITE_BASELINE) {
    writeBaseline(violations);
    console.log(`Wrote ${violations.length} architecture baseline entries to ${relative(ROOT, BASELINE_PATH)}.`);
    return;
  }

  const currentKeys = new Set(violations.map((entry) => entry.key));
  const baselineKeys = new Set(baseline.map((entry) => entry.key));
  const newViolations = violations.filter((entry) => !baselineKeys.has(entry.key));
  const staleBaseline = baseline.filter((entry) => !currentKeys.has(entry.key));

  if (newViolations.length === 0 && staleBaseline.length === 0) {
    console.log(`Architecture boundary check passed (${violations.length} baseline violations).`);
    return;
  }

  if (newViolations.length > 0) {
    console.error(`New architecture boundary violations (${newViolations.length}):`);
    printViolations(newViolations);
  }
  if (staleBaseline.length > 0) {
    console.error(`Stale architecture baseline entries (${staleBaseline.length}); remove them from ${relative(ROOT, BASELINE_PATH)}:`);
    printViolations(staleBaseline);
  }
  process.exitCode = 1;
}

function findViolations(): Violation[] {
  const files = listTsFiles(SRC_ROOT);
  const violations: Violation[] = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const fromModule = moduleOf(file);
    if (!fromModule) continue;
    violations.push(...findOhquantPathViolations(file, source, fromModule));
    for (const specifier of importSpecifiers(source)) {
      const target = resolveLocalImport(file, specifier);
      if (!target) continue;
      const toModule = moduleOf(target);
      if (!toModule || toModule === fromModule) continue;
      for (const rule of RULES) {
        if (!rule.from.includes(fromModule) || !rule.blockedTo.includes(toModule)) continue;
        const violation = {
          rule: rule.id,
          from: toProjectPath(file),
          to: toProjectPath(target),
          specifier,
          reason: rule.reason,
        };
        violations.push({
          ...violation,
          key: [violation.rule, violation.from, violation.to, violation.specifier].join("|"),
        });
      }
    }
  }
  return violations.sort(compareViolation);
}

function findOhquantPathViolations(file: string, source: string, fromModule: string): Violation[] {
  if (fromModule === "storage") return [];
  const violations: Violation[] = [];
  const lines = source.split("\n");
  lines.forEach((lineText, index) => {
    if (!/(^|[^.\w])(?:join|resolve)\s*\(/.test(lineText) || !lineText.includes(".ohquant")) return;
    const pathLiteral = lineText.match(/["'](\.ohquant[^"']*)["']/)?.[1] ?? ".ohquant";
    const violation = {
      rule: "storage-owns-ohquant-paths",
      from: `${toProjectPath(file)}:${index + 1}`,
      to: ".ohquant",
      specifier: pathLiteral,
      reason: "Only storage should construct .ohquant filesystem paths.",
    };
    violations.push({
      ...violation,
      key: [violation.rule, violation.from, violation.to, violation.specifier].join("|"),
    });
  });
  return violations;
}

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === "node_modules" || entry === "dist") continue;
      out.push(...listTsFiles(full));
      continue;
    }
    if (!entry.endsWith(".ts")) continue;
    const projectPath = toProjectPath(full);
    if (projectPath.endsWith(".test.ts")) continue;
    if (projectPath.includes("/test/") || projectPath.includes("/tests/")) continue;
    out.push(full);
  }
  return out;
}

function importSpecifiers(source: string): string[] {
  const specifiers = new Set<string>();
  const staticImportRe = /\b(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?["']([^"']+)["']/gms;
  const dynamicImportRe = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/gms;
  for (const match of source.matchAll(staticImportRe)) specifiers.add(match[1]!);
  for (const match of source.matchAll(dynamicImportRe)) specifiers.add(match[1]!);
  return [...specifiers].filter((specifier) => specifier.startsWith("."));
}

function resolveLocalImport(fromFile: string, rawSpecifier: string): string | null {
  const specifier = rawSpecifier.split("?")[0]!;
  const base = resolve(dirname(fromFile), specifier);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function moduleOf(file: string): string | null {
  const rel = toProjectPath(file);
  if (!rel.startsWith("src/")) return null;
  const rest = rel.slice("src/".length);
  const first = rest.split("/")[0]!;
  if (first.endsWith(".ts")) return "app";
  return first;
}

function loadBaseline(): Violation[] {
  if (!existsSync(BASELINE_PATH)) return [];
  const parsed = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as { violations?: Violation[] };
  return [...(parsed.violations ?? [])].sort(compareViolation);
}

function writeBaseline(violations: Violation[]): void {
  mkdirSync(dirname(BASELINE_PATH), { recursive: true });
  writeFileSync(
    BASELINE_PATH,
    `${JSON.stringify({ violations }, null, 2)}\n`,
    "utf8",
  );
}

function printViolations(violations: Violation[]): void {
  for (const violation of violations.slice(0, 50)) {
    console.error(`- ${violation.rule}: ${violation.from} -> ${violation.to} (${violation.specifier})`);
  }
  if (violations.length > 50) console.error(`... ${violations.length - 50} more`);
}

function compareViolation(a: Violation, b: Violation): number {
  return a.key.localeCompare(b.key);
}

function toProjectPath(file: string): string {
  return relative(ROOT, file).replace(/\\/g, "/");
}


main();
