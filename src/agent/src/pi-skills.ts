// Pi 1.2.0 exports these helpers through its application-wide SDK barrel only.
// Import the shipped modules here so standalone bundles don't pull in Pi's CLI,
// provider registration and session runtime. Keep this adapter and the exact
// package version together; loading and split-bundle tests cover upgrades.
export { loadSkills, loadSkillsFromDir, formatSkillsForPrompt } from "../../../node_modules/@earendil-works/pi-coding-agent/dist/core/skills.js";
export { parseFrontmatter } from "../../../node_modules/@earendil-works/pi-coding-agent/dist/utils/frontmatter.js";
export { createSyntheticSourceInfo } from "../../../node_modules/@earendil-works/pi-coding-agent/dist/core/source-info.js";
export type { ResourceDiagnostic } from "../../../node_modules/@earendil-works/pi-coding-agent/dist/core/diagnostics.js";
