import { describe, expect, it } from "bun:test";
import { toSkillEntries } from "./skill-suggestions.ts";

describe("runtime skill suggestions", () => {
  it("maps discovered skills to the small TUI suggestion contract", () => {
    expect(toSkillEntries([
      { name: "alpha", description: "Alpha workflow", scope: "project" },
      { name: "notes", description: "Personal notes", scope: "user" },
    ])).toEqual([
      { name: "alpha", description: "Alpha workflow", scope: "project" },
      { name: "notes", description: "Personal notes", scope: "user" },
    ]);
  });
});
