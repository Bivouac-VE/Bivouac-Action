# GitHub Marketplace listing — Bivouac — Autonomous dependency remediation for GitHub

> Below is the copy and metadata the owner pastes into GitHub's Marketplace
> publisher form. Each section corresponds to one publisher field. Copy the
> block under each `##` heading into the matching input. No words here are
> action code; this is content for the publisher UI only.

## Listing title

> Copy this line into the **Listing title** field of the Marketplace publisher
> form.

```
Bivouac — Autonomous dependency remediation for GitHub
```

## Short description

> Copy this line into the **Short description** field. GitHub's publisher caps
> this field at 150 characters — the line below is 144 characters including
> spaces and the trailing period.

```
Investigates vulnerable & breaking dependency updates, opens the fix, runs your test suite, and merges when policy passes.
```

Covers, in order: **Investigate** (vulnerable & breaking dependency updates) →
**Fix** (opens the fix) → **Test** (runs your test suite) → **Merge** (merges
when policy passes).

## Long description (About this GitHub Action)

> Copy the block below into the **About this GitHub Action** field.

> Your dependency PRs shouldn't require a developer.

**Bivouac turns dependency alerts into tested, automated remediation.** When
a new Dependabot, Renovate, or Snyk PR opens, Bivouac runs a four-step
remediation loop — **Investigate** the bump, **Fix** the version-aware code
change, **Test** the result against your suite, and **Merge** when the policy
pack passes. No human in the loop required.

`bivouac-action` is the GitHub-side surface: a free, open-source GitHub
Action that runs the **Investigate** step on every dependency-bump PR. It
reads the `package.json` diff, matches every bumped dependency against a
built-in known-CVE table, walks each package's release notes between the old
and new versions, and posts (or rewrites in place) a single PR comment
summarising the findings — no LLM, no third-party key beyond your
`GITHUB_TOKEN`. When a breaking-change signal fires, the action also splices
a warning block into the PR description so reviewers see it before the merge
button is ever clicked.

The reported findings feed the rest of the remediation loop: Bivouac opens
the fix, runs the test suite, and merges when the policy pack passes. The
action is the entry point — the comment it posts is the verification record
the rest of the loop is grounded in.

### Works alongside: Dependabot, Renovate, Snyk, GitHub Actions

Bivouac is not a replacement for anything already in your stack. It sits on
top of the tools you depend on and adds the Investigate → Fix → Test → Merge
loop they don't provide on their own:

- **Dependabot** — surfaces the alerts. Bivouac turns each alert into a
  tested, auto-remediated PR.
- **Renovate** — schedules the updates. Bivouac investigates the bumps and
  drives them to a green merge.
- **Snyk** — flags the vulnerabilities. Bivouac grounds the fix in the
  advisory and runs the test suite before merging.
- **GitHub Actions** — runs CI. Bivouac uses your existing test suite as the
  policy gate for auto-merge.

### Quickstart

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

### Why install this

If your team is already running Dependabot, Renovate, or Snyk, you have the
alerts — but you still have to read the alert, evaluate the breaking change,
write the fix, run the tests, and press the merge button yourself. Bivouac
moves every one of those steps out of your inbox and into a verified pipeline.
Open-source action, MIT licensed, no Bivouac account required.

## Categories

> Pick the closest one(s) in the publisher dropdown — these are the most
> common fits.

- `Code Quality`
- `Dependency Management`
- `Security`

## Tags / keywords

> Comma-separated, ≤10. Paste into the **Tags / Keywords** field.

```
dependency-updates, vulnerabilities, cve, remediation, dependabot, renovate, auto-merge, github-actions, pull-requests, breaking-changes
```

## Permissions required

> Specifies the minimum `permissions:` block needed in a consuming workflow.
> Matches the README's quickstart exactly.

```
pull-requests: write
```

`contents: write` is **not** required.

## Support / contact

> Single line — paste into the **Support / Contact** field.

```
Open an issue: https://github.com/Bivouac-VE/bivouac-action/issues
```

## Versioning notes (for the owner)

> Not a publisher field. These are the two follow-up steps the **owner** owns,
> outside the scope of this listing copy.

1. **`action/action.yml` `description:`** — if the owner wants the in-repo
   `description:` field (displayed on the action's repo header and inside
   the Actions tab) to mirror the new Marketplace thumbnail, update it
   separately. The current value is:
   `Posts a PR comment summarising known CVEs and breaking-change warnings for bumped deps; mirrors breaking-change findings to the PR description.`
   Replace that with a tighter one-line marketing summary if desired.
2. **Marketplace enrollment + submission** — the GitHub Marketplace
   publisher account enrollment, organisation verification, and the actual
   "Submit for review" step are owner-side tasks that happen *in* GitHub's
   publisher flow, not in this repository. This file is the **content** that
   gets pasted into that flow; the flow itself is the owner's own step.
