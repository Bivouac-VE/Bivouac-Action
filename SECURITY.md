# Security policy

## Reporting a vulnerability

Please don't open a public issue for security problems. Use GitHub's private
reporting instead: **Security → Report a vulnerability** on this repository,
or email **vlad@getbivouac.com**.

We'll acknowledge your report within 3 business days and keep you updated
until it's resolved.

## Supported versions

Fixes go into the latest release, and the `v1` tag is moved to it. Please use
`@v1` or the latest `v1.x.y`.

## Scope

The Action reads pull request files and public package metadata, and writes one
PR comment and an optional block in the PR description. It needs only
`pull-requests: write` and sends no data to Bivouac or third parties.
