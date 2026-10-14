import type { AlphaBacktestRequest, AlphaBacktestResult } from "../types/alpha.ts";

export interface AlphaBacktestEngine {
  run(request: AlphaBacktestRequest, signal?: AbortSignal): Promise<AlphaBacktestResult>;
}

export type AlphaErrorCode = "input" | "unavailable" | "version" | "timeout" | "cancelled" | "process" | "output";

export class AlphaEngineError extends Error {
  readonly code: AlphaErrorCode;
  constructor(code: AlphaErrorCode, message: string) {
    super(message);
    this.name = "AlphaEngineError";
    this.code = code;
  }
}
