# Bivouac — Autonomous dependency remediation for GitHub

> Your dependency PRs shouldn't require a developer.

**Bivouac turns dependency alerts into tested, automated remediation.** When a
new Dependabot, Renovate, or Snyk PR opens, Bivouac investigates the bump,
opens the fix, runs your test suite, and merges when the policy pack passes —
no human in the loop required.

`bivouac-action` is the GitHub-side surface that you install: a free, no-account
GitHub Action that watches your PRs and performs the **Investigate** step of
that flow in place — matching every bumped dependency against a known-CVE
table and flagging breaking changes in upstream release notes so the rest of the
remediation pipeline has a verified starting point.

## How it works

Bivouac runs a four-step remediation loop. The open-source action ships the
**Investigate** step out of the box; the rest is the broader Bivouac product
that the action is the entry point into.

### Investigate

When a dependency-bump PR opens — from Dependabot, Renovate, Snyk, or anything
else that opens a PR — `bivouac-action` reads the `package.json` diff, matches
every bumped dependency against a built-in known-CVE table (`lodash`,
`minimist`, `node-fetch`, `axios`, `tough-cookie`), and walks each package's
release notes between the old and new versions. Bumps whose release notes
contain a `BREAKING`, `major:`, `removed`, or `deprecated API(s)` marker are
surfaced as quoted snippets with a link back to the upstream release. No LLM,
no third-party key beyond your `GITHUB_TOKEN`.

The action posts (or rewrites in place) a single PR comment summarising the
findings, and — when any breaking-change signal fires — splices a warning block
into the PR description so it's visible to reviewers before the merge button is
ever clicked.

### Fix

Once the investigation is grounded in real findings, Bivouac opens the
remediation PR with a version-aware code change. The fix is scoped to the
specific breaking-change signals Investigate surfaced — a renamed method, a
removed API, a deprecated alias — rather than a blanket version bump.

### Test

Bivouac runs the repository's test suite against the fix under the same policy
pack that gated the remediation PR. A failing test is a signal, not a roadblock:
Bivouac reports it with the failing assertion quoted so the next loop iteration
has a concrete target.

### Merge

When the suite is green and the policy pack passes, Bivouac merges. No
developer needed.

## Quickstart

Drop this into `.github/workflows/bivouac.yml`:

```yaml
name: Bivouac Action

on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  pull-requests: write # required to post the comment
  contents: read

jobs:
  bivouac:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: Bivouac-VE/bivouac-action@v1
        with:
          github-token: ${{ github.token }}
```

Bivouac investigates each Dependabot / Renovate / Snyk PR as it opens — drop
the step in and your next dependency alert goes through Investigate → Fix →
Test → Merge without a human.

## Works alongside your existing tools

Bivouac is **not** a replacement for anything already in your stack. It sits on
top of the tools you depend on and adds the Investigate → Fix → Test → Merge
loop they don't provide on their own:

- **Dependabot** — surfaces the alerts. Bivouac turns each alert into a tested,
  auto-remediated PR.
- **Renovate** — schedules the updates. Bivouac investigates the bumps and
  drives them to a green merge.
- **Snyk** — flags the vulnerabilities. Bivouac grounds the fix in the
  advisory and runs the test suite before merging.
- **GitHub Actions** — runs CI. Bivouac uses your existing test suite as the
  policy gate for auto-merge.

Bivouac is purely additive — the open-source action is a one-step drop-in
to a workflow you already have.

## Inputs

| Name | Required | Default | Description |
| --- | --- | --- | --- |
| `github-token` | yes | `${{ github.token }}` | Token used to read files and post the PR comment. |
| `comment-marker` | no | `<!-- bivouac-action -->` | Marker string used to tag and locate the posted comment. Change it to namespace the comment under a different label. |

## Outputs

| Name | Description |
| --- | --- |
| `cve-summary` | JSON array of `{ name, from, to, cves, breakingChanges }` — one entry per npm bump detected. |
| `breaking-summary` | JSON array of `{ name, from, to, breakingChanges }` — entries for bumps whose release notes contain a `BREAKING`/`major:`/`removed`/deprecated marker. |
| `breaking-change-summary` | JSON array of `{ name, from, to, findings }` — one finding per upstream breaking-change signal. Each finding carries `category`, `summary`, `migrationNote`, `version`, `url`, `markers`. Sources: `github-releases`, `changelog-md`, `major-version-diff`. |
| `comment-id` | The numeric ID of the posted (or updated) PR comment. |
| `pr-warning-count` | Number of packages with at least one breaking-change finding, surfaced on the PR description. |
| `pr-description-updated` | `"true"` if the PR body was rewritten with the warnings block, `"false"` otherwise (no findings, or update failed). |

## What Bivouac posts on your PR

The posted comment starts with the marker line, a single `## Dependency bump
CVE summary` heading, a one-line summary of how many bumps matched an
advisory or flag a breaking-change marker, and one section per bump. Each
section shows the `(from, to)` pair, a CVE table, and — when applicable — a
"Breaking changes (release notes)" block. Each breaking-change entry quotes
the matched marker line and links to the upstream release:

```
**Breaking changes** (release notes):

> _"BREAKING: rename .remove to .delete; deprecated API removedForEach"_ — [release `5.0.0`](https://github.com/lodash/lodash/releases/tag/5.0.0)
> _Detected markers: BREAKING, removed, deprecated._
```

Bumps with no matching advisory render a single `_No CVEs match the new
version._` line in the table, and a bump whose release notes carry no
breaking-change marker simply has no "Breaking changes" block.

In addition to the PR comment, when any of the breaking-change signals
fires (a `BREAKING`/`major:`/`removed`/`deprecated API(s)` marker in release
notes, a corresponding block in `CHANGELOG.md`, or a major-version boundary
crossing) the Action also rewrites the PR description to append a single
warning block that names the offending package, quotes the upstream change
verbatim, and links to the source:

```
<!-- bivouac-action:pr-warnings:start -->
## ⚠️ Breaking change warnings (bivouac-action)

The following bumped packages have documented breaking changes between the old and new versions on this PR. Review before merging.

### `lodash` `4.16.0` → `5.0.0`

> [breaking] "BREAKING: rename .remove to .delete across the core tree." — [release notes (5.0.0)](https://github.com/lodash/lodash/releases/tag/5.0.0)
> _Migration:_ **use lodash.delete instead of lodash.remove**
> _Source:_ `github-releases` · _Detected markers:_ BREAKING, deprecated

> [breaking] "Major-version boundary" — [major-version-diff (5.0.0)](https://github.com/lodash/lodash/releases/tag/v5.0.0)
> _Migration:_ **Read upstream major-version diff for migration notes.**
> _Source:_ `major-version-diff` · _Detected markers:_ major

<!-- bivouac-action:pr-warnings:end -->
```

The warning block is **idempotent on PR synchronize** — re-runs replace the
previous block (spliced between the `<!-- bivouac-action:pr-warnings:start -->`
and `<!-- bivouac-action:pr-warnings:end -->` markers) rather than appending
a duplicate. Content outside those markers — including any human-written
description text — is preserved.

**Permissions.** Writing the PR description requires only the same
`pull-requests: write` scope the comment-posting step already needs;
`contents: write` is **not** required. The README's `permissions:` block in
the workflow example is sufficient out of the box.

**Best-effort.** The PR-description rewrite is best-effort: if
`pulls.update` fails (for example, the token has been revoked mid-job, the
PR is locked, or GitHub returns a transient error) the Action logs a
`core.warning`, leaves the PR description untouched, and continues the
job — `comment-id` still records the posted comment and any downstream
test-run still executes.

## CVE + breaking-change coverage

The MVP ships a static table of well-known npm advisories across `lodash`,
`minimist`, `node-fetch`, `axios`, and `tough-cookie`. A bump whose `to`
version is strictly less than the advisory's `fixedVersion` matches; a bump
that lands exactly on the fixed version is treated as already-patched.

Breaking-change detection walks the npm registry + GitHub Releases between
the old and new versions. Releases whose notes mention `BREAKING`/`major:`/
`removed`/`deprecated API(s)` are flagged; the entry quotes the marker line
verbatim and links to the upstream release.

## Privacy

- This Action calls the **GitHub REST API** (reading diffs + posting the
  comment) and the **public npm registry** (reading `package.json` for the
  bumped package). No Bivouac endpoint, no third-party vendor.
- Add your `GITHUB_TOKEN` and you're set — no Bivouac API key.

## Local development

```bash
npm ci
npm test          # node --test, runs test/*.test.ts
npm run typecheck # tsc --noEmit
npm run build     # @vercel/ncc → dist/index.js
```

`dist/index.js` is the file referenced by `action.yml` (`runs.main`). Rebuild
it before publishing a release.

## License

[MIT](./LICENSE).
