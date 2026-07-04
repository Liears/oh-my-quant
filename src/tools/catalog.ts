/** Compatibility facade for tool display metadata. */

export type { DataProvider, ToolDisplay } from "./display.ts";
export { shellDisplayName } from "./shell.ts";
export {
  DATA_SOURCE_PROMPTS,
  formatCompletedToolLine,
  formatToolArgs,
  formatToolLine,
  normalizeDataSourceFlag,
  toolDisplayLabel,
  toolNamespacedLabel,
  toolSpecificLabel,
} from "../runtime/tool-display.ts";
