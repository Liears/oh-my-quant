import { createAgent, type QuantAgentOptions, type QuantAgentSession } from "../agent/src/session.ts";
import { createDefaultSessionDependencies } from "./session-dependencies.ts";

/** Application entry for local settings, tools, skill discovery and JSONL sessions. */
export function createLocalAgent(options: QuantAgentOptions = {}): QuantAgentSession {
  return createAgent({ cwd: options.cwd, dependencies: options.dependencies ?? createDefaultSessionDependencies(options) });
}
