# Contributing to bivouac-action

Thanks for helping. The most useful contributions are:

- **False positives or misses.** An advisory shown that doesn't apply, a missing
  one, or a "breaking change" that isn't one. Please include the package, the
  versions and a link to the PR if it's public.
- **Ecosystem requests.** Tell us which package manager and files you use.
- **Fixes and new ecosystems.** Pull requests are welcome.

## Development

```bash
npm ci
npm test          # node --test, runs test/*.test.ts
npm run typecheck # tsc --noEmit
npm run build     # bundles src/ into dist/index.js
```

`dist/index.js` is what GitHub runs, so commit it with your change. CI checks
that it is up to date.

## Where things live

- `src/ecosystems.ts`: reading bumps from manifests and lockfiles
- `src/cve-lookup.ts`: GitHub Advisory Database queries
- `src/changelog-lookup.ts`: release-note and CHANGELOG scanning
- `src/comment.ts`: the PR comment

Adding an ecosystem usually means a parser in `ecosystems.ts`, a mapping to the
advisory database's ecosystem name, a way to find the package's repository in
`changelog-lookup.ts`, and tests.

## Pull requests

Keep changes focused, add tests, and describe what you changed and why.
By contributing you agree that your contribution is licensed under the MIT
License.
