# CI and npm Releases

Automation is maintained in [issue #17](https://github.com/yangjingo/oh-my-quant/issues/17). The npm package is `whyj-quant`; its executable is `whyj`.

## Issues and Pull Requests

Use the [implementation issue form](../../.github/ISSUE_TEMPLATE/implementation.yml) to define one module and checkable acceptance criteria, then complete the [PR template](../../.github/pull_request_template.md). Keep exactly one standalone `Closes #<issue>` line. Link dependencies without closing them. Follow [AGENTS.md](../../AGENTS.md) and its Issue/PR skills.

Follow the shared [writing conventions](../../AGENTS.md#writing-style): prefer English and aim for at most 1,000 words per Issue/PR description, with a clear problem, solution, and evidence. These language and length preferences are not CI gates. Preserve the PR template's English headings because policy parses them. Before opening a non-Draft PR or marking it ready, complete the local checks in [pr-skill](../../.agents/skills/pr-skill/SKILL.md#before-commit-and-push). Keep evidence aligned with the submitted content, and recheck policy runs triggered by the final description as well as CI for the final code revision.

`main` is the stable iterative development version and the final integration target. It is not a scratch branch, and its current revision need not equal the latest published npm release. Develop changes in issue branches and merge reviewed, verified revisions into `main`; stacked PRs are temporary dependencies, not permanent alternative integration branches.

Prefer a dedicated issue worktree: [Issue worktree handoff](../../.agents/skills/issue-skill/SKILL.md#worktree-handoff) records the branch, path, and verified base; [PR post-merge cleanup](../../.agents/skills/pr-skill/SKILL.md#post-merge-cleanup) defines delivery checks and removal. When carrying out an authorized merge into `main`, finish by removing the delivered remote branch, local branch, and completed worktree after preserving private state and verification receipts. Keep unfinished or dependent work and report any cleanup blocker. Recheck remote heads and use an expected-head lease for deletion so concurrent updates survive. These are contributor procedures, not background automation or GitHub enforcement. GitHub's automatic branch deletion affects remote branches only. Merging does not authorize discarding ignored evidence or private state; a closed-but-unmerged issue or PR is not a merged delivery.

[PR policy](../../.github/workflows/pr-policy.yml) reads the trusted base revision, never PR code. It checks an open issue rather than a PR number, completed sections, a non-deleted Markdown change under `docs/`, and other open PRs using the canonical closing format. Examples inside comments or code do not count. Scope, evidence quality, UI captures, and whether documentation reflects behavior remain review responsibilities.

The check runs on PR creation, body edits, pushes, reopening, and readiness changes. It does not reconcile later issue-only changes or provide atomic enforcement across concurrent PRs. The first PR introducing this trusted-base workflow needs explicit policy validation; automatic enforcement starts after the workflow reaches the base branch.

Run policy and documentation-link regression cases with `bun run check:quality`. The [technical article](../blog/agent-repo-infrastructure.md) explains the design and external references.

## Continuous Integration

PR review uses [review-skill](../../.agents/skills/review-skill/SKILL.md) to distinguish code defects, merge conflicts, and final-revision verification. Record the remote base and head SHAs, inspect interacting changes, and separate confirmed findings from optional suggestions. An old green check or a clean textual merge does not establish readiness of the latest integrated revision. This is a contributor procedure, not an additional configured GitHub rule. The [review section of the repository infrastructure article](../blog/agent-repo-infrastructure.md#review) explains the observed cases and tradeoffs.

For each applicable check, record its workflow/job, trigger event, PR head/base and actual tested revision, environment, status, and run link. Keep failed, pending, cancelled, skipped, and absent checks distinct from success. Inspect triggers and logs before classifying a failure as a product regression, a baseline failure, an infrastructure problem, or unresolved. Preserve the first failure when rerunning and explain what the rerun establishes; a timeout alone does not establish flakiness.

[CI](../../.github/workflows/ci.yml) runs on pull requests, pushes to `main`, manual dispatch, and calls from the release workflow. Both Windows and Linux use Bun 1.3.14 and Node 24:

```sh
bun install --frozen-lockfile
bun run check:release
```

The release gate covers types, architecture, quality-policy regressions, test organization, all automated tests, the CLI build, and documentation build/checks. CI then packs the npm artifact, installs it outside the checkout, and checks its version using Node. Install scripts are disabled for this smoke test. It proves package startup, not live providers, interactive behavior, or every supported Node version. Missing ignored `output/` receipts are reported as unavailable historical evidence; source, current docs, navigation, and anchors remain strict.

The existing Desktop workflow remains responsible for installers. After these workflows reach the default branch, configure `CI required` and `PR policy` as required checks in GitHub branch protection. The CI aggregate fails unless every platform succeeds. Workflow files alone do not enable branch protection. Add Desktop checks separately where installer validation is required.

Desktop currently runs on qualifying pushes to `main` or manual dispatch, not on `pull_request`; inspect its path filters and inputs before treating an absent PR check as coverage. A successful PR CI run does not establish post-merge Desktop success. After an authorized merge, inspect the applicable runs on the merge revision and report any failures separately. For stacked PRs, record the remaining dependency and verify against the updated base before the next merge; retain a parent branch/worktree while an open child still depends on it, following [PR cleanup](../../.agents/skills/pr-skill/SKILL.md#post-merge-cleanup).

## npm Setup

In the npm settings for `whyj-quant`, configure a GitHub Actions Trusted Publisher:

| Setting | Value |
| --- | --- |
| Owner | `yangjingo` |
| Repository | `oh-my-quant` |
| Workflow filename | `npm-publish.yml` |
| Environment | Leave empty |

Allow direct `npm publish` when creating the configuration; new configurations may default to staged publishing. Complete setup shortly before the first release: unused configurations expire after two days. See [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/).

The workflow uses GitHub-hosted runners, npm >=11.5.1, and `id-token: write` in the publishing job. No `NPM_TOKEN` secret is required. Public publication includes provenance.

## Release Procedure

1. Update the stable version in `package.json` and the lockfile as needed, update release documentation, and merge reviewed changes into `main`.
2. Open **Actions → Publish npm → Run workflow**, select `main`, enter the exact package version, and keep `dry_run` enabled.
3. Inspect both CI platforms and the dry-run package listing. The publishing job runs `prepublishOnly`, including insight generation and the complete release gate.
4. Run the same workflow with `dry_run` disabled to publish. Confirm the selected revision still represents the reviewed release; each dispatch checks its own fixed commit.
5. Verify the published version and provenance on npm, then test `npm install -g whyj-quant@<version>` and `whyj --version` in a clean environment.

Only stable versions are supported, published under `latest`. Dispatches are serialized. A dry run neither uploads a package nor proves OIDC authentication. Successful local validation does not prove GitHub runner execution or npm configuration.

## Failures and Recovery

Inspect the failed job before retrying; do not skip checks to release. Existing npm versions cannot be overwritten. If publication succeeded but later verification failed, inspect the registry before rerunning and prepare a new patch version when needed. Disable the workflow to pause releases; revert workflow changes through a normal PR.
