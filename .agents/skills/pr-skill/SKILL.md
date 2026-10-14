---
name: pr-skill
description: Prepare and review single-issue PRs for oh-my-quant with complete testing, current documentation, UI evidence, and final-commit CI verification.
---

# PR Skill

## Scope

- Require one implementation issue; use [issue-skill](../issue-skill/SKILL.md) if missing. Continue an existing implementation PR when available.
- Follow the issue's primary module, allowed paths, and acceptance criteria. Split unrelated problems or independent module changes.
- Confirm the base branch and inspect the full diff. Preserve others' uncommitted work.

## Before Commit and Push

1. Verify every acceptance criterion, including relevant error cases and compatibility. Bug regressions must expose the original failure.
2. Read current `package.json` scripts and workflows. Run `bun run check:release`; confirm coverage of type checking, architecture, test organization, the full test suite, and build. Run documentation checks separately if not included.
3. Add applicable module and end-to-end checks. Desktop changes require desktop typecheck/build; installer changes require actual package verification of paths, shortcuts, upgrade/reinstall behavior, and data retention in an isolated environment.
4. Record commands, environment, results, and evidence. Distinguish synthetic tests from live-service validation. Rerun affected checks after edits; ensure the complete gate remains valid for the final content.
5. Inspect the staged diff and run `git diff --check`. Commit only issue-related files. Report baseline failures without weakening assertions or claiming success. Push an incomplete WIP/draft only when explicitly requested.

Local checks precede the final commit and push. CI follows the push and must pass before merge readiness.

## Documentation

Update the relevant current `docs/` pages in every PR. Explain changed behavior, contracts, boundaries, or verification procedures; avoid cosmetic edits solely to satisfy this requirement. README, CHANGELOG, and PR text are not substitutes.

Prefer existing pages. Update navigation and generated documentation when applicable. Keep commands, links, and evidence aligned with the implementation.

## Visual Evidence

For visible Web, desktop, TUI, or HTML-report changes:

- Provide actual before/after screenshots, or captures of new interfaces. Include recordings or sequential captures for interactions.
- Record the code revision, environment, viewport, state, and reproduction steps. Cover affected normal, empty, loading, and error states; include narrow/wide layouts where relevant.
- Check affected text layout, overflow, keyboard/focus behavior, and runtime errors.
- Label mockups as design intent. Do not substitute generated or outdated images for implementation evidence.
- Use reviewer-accessible links or CI artifacts; redact private data. Store lasting images under `docs/assets/` and exclude temporary captures.

For internal changes, briefly explain why visual evidence is inapplicable.

## Technical Blog: Recommended for Major Changes

For substantial features or non-obvious design decisions, consider a focused article in `docs/blog/`. Explain the problem, prior limitations, alternatives, chosen mechanism, evidence, costs, and remaining limits. Link claims to implementation or verification; distinguish facts from proposals.

Follow the [blog guide](../../../docs/blog/README.md), update navigation/generated pages as needed, and link the article from the PR. Keep it within the same issue. Blogs supplement current module documentation and a self-contained PR description; ordinary fixes do not require one.

## PR Template

Title: `<type>(<module>): <behavior change> (#<issue>)`

~~~markdown
Closes #<single-issue>

## Outcome
Problem, before/after behavior, and key design decisions.

## Scope and Documentation
Primary module, justified integration changes, compatibility, and docs links.

## Acceptance
| Criterion | Test or procedure | Result and evidence |
| --- | --- | --- |
| AC1 | ... | ... |

## Verification
Commands, environment, results, final commit SHA, and CI links.
Explicitly list unverified behavior and its impact.

## Visual Evidence
Screenshots or recordings with reproduction details; explain if inapplicable.

## Risks and Rollback
Concrete risks and recovery steps.

## Technical Blog (Optional)
Article link and the design question it explains; omit when unused.
~~~

## Review and Completion

- Close only the primary issue; link dependencies without closing them. Add the PR link to the issue.
- Use `gh` to verify applicable workflows against the final head SHA. Trigger available non-publishing checks within existing authorization when needed.
- Inspect failed job logs and fix confirmed causes; repeated reruns are not a substitute. Require all applicable checks and mandatory manual acceptance before declaring merge readiness.
- Refresh descriptions and evidence after changes. Return the PR link, final SHA, results, and outstanding work.
- Treat PR creation, merging, and publishing as separate actions governed by existing authorization.

This skill does not configure branch protection or CI enforcement.
