import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { parse } from "yaml";
import { checkPullRequest, primaryIssue, validateDescription } from "./pr-policy.mjs";
import { isOptionalPrivateEvidence } from "./documentation-links.mjs";

const body = `Closes #17

## Outcome
Adds repeatable repository quality checks.
## Scope and Documentation
Automation only; docs/quant-harness/ci-release.md updated.
## Acceptance
The invalid policy examples fail.
## Verification
node --test .github/scripts/quality.test.mjs
## Visual Evidence
No user interface changes.
## Risks and Rollback
Revert automation; npm setup remains external.
`;
const files = ["docs/quant-harness/ci-release.md"];

test("accepts one issue and completed sections while ignoring examples", () => {
  assert.equal(validateDescription(body + "\n<!-- Fixes #99 -->\n```md\nCloses #88\n```\n`Fixes #77`", files), 17);
  assert.equal(validateDescription(body + "\n   ```md\nCloses #88\n   ````\n<!-- Fixes #99", files), 17);
});

for (const invalid of ["", "Closes #<issue>", "Closes #0", "Closes #17\nCloses #18", "Closes #17\nFixes #18", "Closes #17\nFixes: #18", "Closes #17, #18", "Closes owner/repo#17", "Closes https://github.com/owner/repo/issues/17", "<!-- Closes #17 -->", "```md\nCloses #17\n```", "   ```md\nCloses #17", "Closes #9007199254740992"]) {
  test(`rejects invalid primary issue: ${JSON.stringify(invalid)}`, () => {
    assert.throws(() => primaryIssue(invalid));
  });
}

test("rejects comment-only template sections and absent current docs", () => {
  assert.throws(() => validateDescription(body.replace("The invalid policy examples fail.", "<!-- Add acceptance evidence -->"), files), /Acceptance/);
  assert.throws(() => validateDescription(body, ["README.md"]), /docs/);
});

function api({ issue = { state: "open" }, other = [], listed = [{ filename: files[0], status: "modified" }], count = 1 } = {}) {
  const listFiles = Symbol("files");
  const list = Symbol("pulls");
  return {
    rest: { pulls: { get: async () => ({ data: { body, changed_files: count } }), listFiles, list },
      issues: { get: async () => ({ data: issue }) } },
    paginate: async method => method === listFiles ? listed : other,
  };
}
const check = options => checkPullRequest({ github: api(options), owner: "owner", repo: "repo", number: 20 });

test("validates a real open issue with no competing implementation PR", async () => {
  assert.equal(await check({ other: [{ number: 20, body }, { number: 21, body: "Refs #17" }] }), 17);
});

test("rejects PR references, closed issues, and competing implementation PRs", async () => {
  await assert.rejects(check({ issue: { state: "open", pull_request: {} } }), /open issue/);
  await assert.rejects(check({ issue: { state: "closed" } }), /open issue/);
  await assert.rejects(check({ other: [{ number: 21, body }] }), /active PR #21/);
});

test("rejects incomplete file pagination and documentation deletions", async () => {
  await assert.rejects(check({ count: 2 }), /every changed file/);
  await assert.rejects(check({ listed: [{ filename: files[0], status: "removed" }] }), /docs/);
});

test("only repository-local output receipts are optional", () => {
  const root = resolve("fixture");
  assert.equal(isOptionalPrivateEvidence(root, resolve(root, "output/run/report.json")), true);
  for (const path of ["docs/missing.md", "src/missing.ts", "output-copy/report.json", "../output/report.json", "output/../docs/missing.md"]) {
    assert.equal(isOptionalPrivateEvidence(root, resolve(root, path)), false, path);
  }
});

test("the actual release guard accepts only main and the exact stable package", t => {
  const workflow = parse(readFileSync(new URL("../workflows/npm-publish.yml", import.meta.url), "utf8"));
  const step = workflow.jobs.validate.steps.find(step => step.name === "Validate release branch and version");
  const code = step.run.split("\n").slice(1, -2).join("\n");
  const directory = mkdtempSync(resolve(tmpdir(), "ohquant-release-guard-"));
  const manifest = resolve(directory, "package.json");
  t.after(() => { unlinkSync(manifest); rmdirSync(directory); });
  for (const [ref, input, version, name, succeeds] of [
    ["refs/heads/main", "1.4.0", "1.4.0", "whyj-quant", true],
    ["refs/heads/feature", "1.4.0", "1.4.0", "whyj-quant", false],
    ["refs/tags/v1.4.0", "1.4.0", "1.4.0", "whyj-quant", false],
    ["refs/heads/main", "1.4.1", "1.4.0", "whyj-quant", false],
    ["refs/heads/main", "1.4.0-rc.1", "1.4.0-rc.1", "whyj-quant", false],
    ["refs/heads/main", "1.4.0", "1.4.0", "other-package", false],
  ]) {
    writeFileSync(manifest, JSON.stringify({ name, version }));
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", code], {
      cwd: directory, encoding: "utf8", env: { ...process.env, GITHUB_REF: ref, RELEASE_VERSION: input },
    });
    assert.equal(result.status === 0, succeeds, `${ref} ${input} ${name}: ${result.stderr}`);
  }
});
