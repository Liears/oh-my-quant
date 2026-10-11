import { relative } from "node:path";

export type FileOperation = "READ" | "WRITE" | "MKDIR" | "DELETE";

export interface FileEvent {
  id: string;
  operation: FileOperation;
  path: string;
  label: string;
  bytes?: number;
  detail?: string;
  timestamp: number;
}

type Listener = (event: FileEvent) => void | Promise<void>;

const listeners = new Set<Listener>();

export function subscribeFileEvents(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitFileEvent(event: Omit<FileEvent, "id" | "label" | "timestamp">): void {
  const fullEvent: FileEvent = {
    ...event,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    label: displayPath(event.path),
    timestamp: Date.now(),
  };
  // Observers do not participate in the transaction or its acknowledgement.
  for (const listener of listeners) {
    try {
      const pending = listener({ ...fullEvent });
      pending?.catch(() => {});
    } catch { /* Keep delivering to the remaining observers. */ }
  }
}

export function displayPath(path: string): string {
  const cwd = process.cwd();
  const rel = relative(cwd, path);
  if (rel && !rel.startsWith("..")) return rel.replace(/\\/g, "/");
  return path.replace(/\\/g, "/");
}
