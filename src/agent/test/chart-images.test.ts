import { expect, it } from "bun:test";
import type { ImageContent } from "@earendil-works/pi-ai";
import { chartImageMime, EphemeralChartImages, MAX_CHART_IMAGE_BYTES } from "../src/chart-images.ts";
import type { AgentMessage } from "../src/session-runtime/index.ts";

const image: ImageContent = { type: "image", mimeType: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jf1sAAAAASUVORK5CYII=" };

it("projects pixels only onto the selected input without mutating the journal messages", () => {
  const images = new EphemeralChartImages(), staged = images.begin([image], { input: ["text", "image"] });
  const messages: AgentMessage[] = [{ role: "displayUser", displayText: "chart", content: [{ type: "text", text: staged.note }], timestamp: 0 },
    { role: "user", content: "unrelated", timestamp: 0 }];
  const original = structuredClone(messages), projected = images.project(messages);
  expect(projected[0]).toHaveProperty("content.1", image);
  expect(projected[1]).toBe(messages[1]); expect(messages).toEqual(original);
  expect(images.project(projected)).toEqual(projected);
  expect(staged.note).not.toContain(image.data); expect(staged.note).toContain("sha256");
  images.end("another-operation"); expect(images.project(messages)).toEqual(projected);
  images.end(staged.id); expect(images.project(messages)).toBe(messages);
});

it("rejects unsupported models, invalid bytes, MIME mismatches and input limits before staging", () => {
  const images = new EphemeralChartImages();
  expect(() => images.begin([image], { input: ["text"] })).toThrow("image-capable");
  for (const invalid of [{ ...image, data: "!!!!" }, { ...image, mimeType: "image/jpeg" }, { ...image, data: "" },
    { ...image, data: "x".repeat(Math.ceil(MAX_CHART_IMAGE_BYTES / 3) * 4 + 1) }]) {
    expect(() => images.begin([invalid], { input: ["image"] })).toThrow();
  }
  expect(() => images.begin([], { input: ["image"] })).toThrow("Supply");
  expect(() => images.begin(Array(5).fill(image), { input: ["image"] })).toThrow("Supply");
  expect(() => images.begin([image, image], { input: ["image"], inputLimits: { images: { maxPerMessage: 1 } } })).toThrow("1..1");
  const large = Buffer.alloc(MAX_CHART_IMAGE_BYTES); Buffer.from(image.data, "base64").copy(large);
  const padded = { ...image, data: large.toString("base64") };
  expect(() => images.begin([padded, padded, image], { input: ["image"] })).toThrow("total");
  const staged = images.begin([image], { input: ["image"] });
  expect(() => images.begin([image], { input: ["image"] })).toThrow("finish"); images.end(staged.id);
});

it("recognizes supported headers and rejects empty or zero-dimension images", () => {
  expect(chartImageMime(Buffer.from(image.data, "base64"))).toBe("image/png");
  expect(chartImageMime(Buffer.from([255, 216, 255, 224, 0, 0, 255, 217]))).toBe("image/jpeg");
  const webp = Buffer.alloc(20); webp.write("RIFF"); webp.writeUInt32LE(12, 4); webp.write("WEBP", 8);
  expect(chartImageMime(webp)).toBe("image/webp"); webp.writeUInt32LE(99, 4); expect(() => chartImageMime(webp)).toThrow();
  const png = Buffer.from(image.data, "base64"); png.writeUInt32BE(0, 16); expect(() => chartImageMime(png)).toThrow();
  expect(() => chartImageMime(Buffer.alloc(0))).toThrow();
});
