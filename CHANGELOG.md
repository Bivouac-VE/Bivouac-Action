# Changelog

## v1.2.0

- **npm lockfiles**: reads `package-lock.json` and `npm-shrinkwrap.json`
  (v1 to v3), so Dependabot security PRs that only bump an indirect dependency
  are covered. Indirect dependencies are labelled as such.
- **Python**: `requirements*.txt` (pinned `==`), `poetry.lock` and `uv.lock`.
- **Go**: `go.mod`, including `// indirect` modules.
- Each bump in the comment now shows its ecosystem and file.
- Breaking-change detection ignores negated or lower-case mentions such as
  "no breaking changes" or "fixed a bug breaking X".
- Large lockfiles (over 1 MB) are read in full; at most 40 bumps are analysed
  per PR, direct dependencies first.
- `actions/checkout` is no longer needed in the workflow.

## v1.1.1

- Each breaking-change finding is its own quote block in the comment.
- README shows an example comment.

## v1.1.0

- Every npm bump is checked against the GitHub Advisory Database, replacing a
  built-in list of five packages.
- New "Fixed by this bump" and "Still vulnerable after this bump" sections, with
  the lowest version that clears all remaining advisories.
- Fixed a v1.0.0 bug that stopped the Action from loading.
- `github-token` is optional.

## v1.0.0

- First Marketplace release.
