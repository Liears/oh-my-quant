# CI and npm Releases

Automation is maintained in [issue #17](https://github.com/yangjingo/oh-my-quant/issues/17). The npm package is `whyj-quant`; its executable is `whyj`.

## Issues and Pull Requests

Use the [implementation issue form](../../.github/ISSUE_TEMPLATE/implementation.yml) to define one module and checkable acceptance criteria, then complete the [PR template](../../.github/pull_request_template.md). Keep exactly one standalone `Closes #<issue>` line. Link dependencies without closing them. Follow [AGENTS.md](../../AGENTS.md) and its Issue/PR skills.

[PR policy](../../.github/workflows/pr-policy.yml) reads the trusted base revision, never PR code. It checks an open issue rather than a PR number, completed sections, a non-deleted Markdown change under `docs/`, and other open PRs using the canonical closing format. Examples inside comments or code do not count. Scope, evidence quality, UI captures, and whether documentation reflects behavior remain review responsibilities.

The check runs on PR creation, body edits, pushes, reopening, and readiness changes. It does not reconcile later issue-only changes or provide atomic enforcement across concurrent PRs. The first PR introducing this trusted-base workflow needs explicit policy validation; automatic enforcement starts after the workflow reaches the base branch.

Run policy and documentation-link regression cases with `bun run check:quality`. The [technical article](../blog/agent-repo-infrastructure.md) explains the design and external references.

## Continuous Integration

[CI](../../.github/workflows/ci.yml) runs on pull requests, pushes to `main`, manual dispatch, and calls from the release workflow. Both Windows and Linux use Bun 1.3.14 and Node 24:

```sh
bun install --frozen-lockfile
bun run check:release
```

The release gate covers types, architecture, quality-policy regressions, test organization, all automated tests, the CLI build, and documentation build/checks. CI then packs the npm artifact, installs it outside the checkout, and checks its version using Node. Install scripts are disabled for this smoke test. It proves package startup, not live providers, interactive behavior, or every supported Node version. Missing ignored `output/` receipts are reported as unavailable historical evidence; source, current docs, navigation, and anchors remain strict.

The existing Desktop workflow remains responsible for installers. After these workflows reach the default branch, configure `CI required` and `PR policy` as required checks in GitHub branch protection. The CI aggregate fails unless every platform succeeds. Workflow files alone do not enable branch protection. Add Desktop checks separately where installer validation is required.

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
