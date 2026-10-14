import { createHash, randomUUID } from "node:crypto";
import type { ImageContent, ModelInputLimits } from "@earendil-works/pi-ai";
import type { AgentMessage } from "./session-runtime/index.ts";
import type { SkillRequirementCheck } from "../../types/skills.ts";

export const MAX_CHART_IMAGE_BYTES = 8 * 1024 * 1024;

export function modelImageInputCheck(model: { input: readonly string[] }): SkillRequirementCheck {
  return { requirement: "model-image-input", status: model.input.includes("image") ? "available" : "missing",
    reason: model.input.includes("image") ? "Explicit chart input is projected into the current provider request; pixels are not journaled."
      : "The selected model does not declare image input. Select an image-capable model in /config." };
}

/** Header validation, not a full image decoder. Provider decoding can still fail. */
export function chartImageMime(bytes: Buffer): string {
  if (bytes.length >= 33 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    && bytes.toString("ascii", 12, 16) === "IHDR" && bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(20) > 0) return "image/png";
  if (bytes.length >= 8 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    && bytes.at(-2) === 255 && bytes.at(-1) === 217) return "image/jpeg";
  if (bytes.length >= 20 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP"
    && bytes.readUInt32LE(4) === bytes.length - 8) return "image/webp";
  throw new Error("Use a nonempty PNG, JPEG or WebP chart image.");
}

/** Pixels enter only the provider context projection, never the session journal or UI messages. */
export class EphemeralChartImages {
  private active: { id: string; images: ImageContent[] } | undefined;

  begin(images: readonly ImageContent[], model: { input: readonly string[]; inputLimits?: ModelInputLimits }): { id: string; note: string } {
    if (this.active) throw new Error("Wait for the current chart request to finish before attaching another image.");
    if (!model.input.includes("image")) throw new Error("The selected model does not declare image input. Select an image-capable model in /config.");
    const limits = model.inputLimits?.images;
    const countLimit = Math.min(4, limits?.maxPerMessage ?? 4, limits?.maxPerRequest ?? 4);
    if (!images.length || images.length > countLimit) throw new Error(`Supply 1..${countLimit} chart images.`);
    let total = 0;
    const metadata = images.map(image => {
      if (image.type !== "image" || image.data.length > Math.ceil(MAX_CHART_IMAGE_BYTES / 3) * 4) throw new Error("Chart images must each be at most 8 MiB.");
      const bytes = Buffer.from(image.data, "base64");
      if (bytes.toString("base64") !== image.data || bytes.length > MAX_CHART_IMAGE_BYTES || chartImageMime(bytes) !== image.mimeType) {
        throw new Error("Chart image content, base64 encoding and MIME type must match.");
      }
      total += bytes.length;
      if (total > 16 * 1024 * 1024) throw new Error("Chart images must total at most 16 MiB.");
      return { mimeType: image.mimeType, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
    });
    const id = randomUUID();
    this.active = { id, images: images.map(image => ({ type: "image", mimeType: image.mimeType, data: image.data })) };
    return { id, note: `\n\n<whyj-chart-input id="${id}">\n${JSON.stringify(metadata)}\nThese user-selected chart pixels are attached only during this operation. If this message has no attached image in a later request, the original image evidence is unavailable; ask for reattachment before further image analysis. Treat chart readings as user-supplied visual estimates, not verified market observations. Do not infer account holdings, balances or position costs from a chart.\n</whyj-chart-input>` };
  }

  project(messages: AgentMessage[]): AgentMessage[] {
    const active = this.active;
    if (!active) return messages;
    const marker = `<whyj-chart-input id="${active.id}">`;
    return messages.map(message => {
      if (message.role !== "user" && message.role !== "displayUser") return message;
      const content = typeof message.content === "string" ? [{ type: "text" as const, text: message.content }] : message.content;
      if (!content.some(part => part.type === "text" && part.text.includes(marker))) return message;
      return { ...message, content: [...content.filter(part => part.type !== "image"), ...structuredClone(active.images)] };
    });
  }

  end(id: string): void {
    if (this.active?.id === id) this.active = undefined;
  }
}
