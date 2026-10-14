import { expect, it } from "bun:test";
import { applyStreamOptionsPatch, cloneStreamOptions, mergeHeaders } from "../src/session-runtime/harness/stream-options.ts";

it("patches request headers and metadata with explicit removal without mutating previous requests", () => {
  const base = { headers: { authorization: "token", remove: "old" }, metadata: { trace: "1" }, maxRetries: 2 };
  const patched = applyStreamOptionsPatch(base, { headers: { remove: undefined, extra: "new" }, metadata: undefined, maxRetries: 0 });
  expect(patched).toMatchObject({ headers: { authorization: "token", extra: "new" }, metadata: undefined, maxRetries: 0 });
  expect(base.headers.remove).toBe("old");
  expect(base.metadata).toEqual({ trace: "1" });
  expect(applyStreamOptionsPatch(base, { headers: undefined }).headers).toBeUndefined();
  const clone = cloneStreamOptions(base);
  clone.headers!.authorization = "rotated";
  expect(base.headers.authorization).toBe("token");
  expect(mergeHeaders(base.headers, { authorization: "override" })?.authorization).toBe("override");
});
