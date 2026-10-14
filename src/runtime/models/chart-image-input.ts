import { open } from "node:fs/promises";
import { resolve } from "node:path";
import type { ImageContent } from "@earendil-works/pi-ai";
import { chartImageMime, MAX_CHART_IMAGE_BYTES } from "../../agent/src/chart-images.ts";

/** Read only the path explicitly selected by the user; no URL, directory or file cache. */
export async function readChartImage(path: string, signal?: AbortSignal): Promise<ImageContent> {
  signal?.throwIfAborted();
  if (!path.trim() || /^[a-z][a-z0-9+.-]*:\/\//iu.test(path)) throw new Error("Select one local chart image path.");
  const file = await open(resolve(path), "r").catch(() => { throw new Error("The selected chart image cannot be opened."); });
  try {
    signal?.throwIfAborted();
    const stat = await file.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > MAX_CHART_IMAGE_BYTES) throw new Error("Select a nonempty chart image file of at most 8 MiB.");
    const bytes = Buffer.alloc(MAX_CHART_IMAGE_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      signal?.throwIfAborted();
      const { bytesRead } = await file.read(bytes, length, bytes.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    signal?.throwIfAborted();
    if (length > MAX_CHART_IMAGE_BYTES) throw new Error("The selected chart image exceeds 8 MiB.");
    const content = bytes.subarray(0, length);
    return { type: "image", mimeType: chartImageMime(content), data: content.toString("base64") };
  } finally { await file.close(); }
}
