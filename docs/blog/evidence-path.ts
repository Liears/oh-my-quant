import { relative, resolve, sep } from "node:path";

/** Local verification receipts are private artifacts, not required clone contents. */
export function isOptionalPrivateEvidence(root: string, target: string): boolean {
  const path = relative(resolve(root), resolve(target));
  return path.startsWith(`output${sep}`);
}

