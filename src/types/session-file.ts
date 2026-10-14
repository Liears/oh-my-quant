/** Byte-versioned persistence; session semantics belong to the agent layer. */
export interface SessionFileSnapshot {
  text: string;
  revision: string;
}

export interface SessionFilePort {
  read(path: string): Promise<SessionFileSnapshot>;
  /** null creates a new file; an existing file may only grow from the expected version. */
  commit(path: string, expectedRevision: string | null, text: string, signal?: AbortSignal): Promise<string>;
  remove(path: string, expectedRevision: string, signal?: AbortSignal): Promise<void>;
}
