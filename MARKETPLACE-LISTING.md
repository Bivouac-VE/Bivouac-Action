# GitHub Marketplace listing — Bivouac — dependency-update checks for GitHub pull requests

> Below is the copy and metadata the owner pastes into GitHub's Marketplace
> publisher form. Each section corresponds to one publisher field. Copy the
> block under each `##` heading into the matching input. No words here are
> action code; this is content for the publisher UI only.

## Listing title

> Copy this line into the **Listing title** field of the Marketplace publisher
> form.

```
Bivouac — dependency-update checks for GitHub pull requests
```

## Short description

> Copy this line into the **Short description** field. GitHub's publisher caps
> this field at 150 characters.

```
Checks dependency-bump PRs for known CVEs and breaking changes, and posts one summary comment.
```


## Long description (About this GitHub Action)

> Copy the block below into the **About this GitHub Action** field.

`bivouac-action` is a free, open-source GitHub Action. On every
dependency-bump PR it reads the `package.json` diff, checks each bumped package
against the GitHub Advisory Database, reads the release notes between the old and
new versions, and posts (or updates) one PR comment summarising the findings.
Breaking-change warnings are also added to the PR description so reviewers see
them before merging. No LLM, no account, no key beyond your `GITHUB_TOKEN`.

The Action is the Investigate step of Bivouac's wider workflow; opening fixes,
running tests and merging are part of the hosted product at getbivouac.com and
are not done by this Action.

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

If you already run Dependabot, Renovate or Snyk, you get the update PRs but
still have to dig through changelogs to see what might break. Bivouac puts the
CVEs and breaking changes for each bumped package straight into the PR.
Open-source, MIT licensed, no Bivouac account required.

## Categories

> Pick the closest one(s) in the publisher dropdown — these are the most
> common fits.

- `Code Quality`
- `Dependency Management`
- `Security`

## Tags / keywords

> Comma-separated, ≤10. Paste into the **Tags / Keywords** field.

```
dependency-updates, vulnerabilities, cve, remediation, dependabot, renovate, code-review, github-actions, pull-requests, breaking-changes
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
