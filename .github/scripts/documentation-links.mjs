import { relative, resolve, sep } from "node:path";

/** Ignored local receipts are not required clone contents; all other links stay strict. */
export function isOptionalPrivateEvidence(root, target) {
  return relative(resolve(root), resolve(target)).startsWith(`output${sep}`);
}
