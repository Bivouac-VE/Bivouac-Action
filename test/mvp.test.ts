// Single end-to-end fixture test for the MVP. A stubbed Octokit receives a
// package.json diff that bumps three npm deps: one positively affected by a
// known CVE (minimist 1.2.0 → 1.2.5), one a "fixed" bump (lodash 4.17.20 →
// 4.17.21) so the new version is past the advisory, and one fictitious bump
// that does not match anything. The action should still post a single
// idempotent comment summarising every bump and only call out the CVE for
// the positive case.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COMMENT_MARKER, process } from '../src/index';
import type { Inputs } from '../src/types';

const FIXTURE_BEFORE =
  '{"name":"fixture","private":true,' +
  '"dependencies":{"minimist":"1.2.0","lodash":"4.17.20","safe-pkg":"1.0.0"}}';
const FIXTURE_AFTER =
  '{"name":"fixture","private":true,' +
  '"dependencies":{"minimist":"1.2.5","lodash":"4.17.21","safe-pkg":"1.2.3"}}';

interface Stub {
  rest: {
    pulls: {
      listFiles: () => Promise<{ data: Array<{ filename: string; status: string }> }>;
      get: () => Promise<{ data: { body: string } }>;
      update: (p: { body: string }) => Promise<{ data: unknown }>;
    };
    repos: { getContent: (p: { ref: string }) => Promise<{ data: { content: string } }> };
    issues: {
      listComments: () => Promise<{ data: Array<{ id: number; body?: string | null }> }>;
      createComment: (p: { body: string }) => Promise<{ data: { id: number } }>;
      updateComment: (p: { body: string; comment_id: number }) => Promise<{ data: { id: number } }>;
    };
  };
  getPosted(): { body: string; id: number; mode: 'created' | 'updated' };
  getUpdatedPrBody(): string | null;
}

function buildStubOctokit(opts: { existing?: number | null; prBody?: string } = {}): Stub {
  let postedBody: string | null = null;
  let updatedPrBody: string | null = null;
  const postedId = 17;
  let createdAt: number | null = null;
  const stub: Stub = {
    rest: {
      pulls: {
        async listFiles() {
          return { data: [{ filename: 'package.json', status: 'modified' }] };
        },
        async get() {
          return { data: { body: opts.prBody ?? '' } };
        },
        async update(params: { body: string }) {
          updatedPrBody = params.body;
          return { data: undefined };
        },
      },
      repos: {
        async getContent(params: { ref: string }) {
          return {
            data: {
              content: Buffer.from(
                params.ref === 'before' ? FIXTURE_BEFORE : FIXTURE_AFTER,
                'utf8',
              ).toString('base64'),
            },
          };
        },
      },
      issues: {
        async listComments() {
          if (typeof opts.existing === 'number') {
            return { data: [{ id: opts.existing, body: `${COMMENT_MARKER}\nold body` }] };
          }
          return { data: [] };
        },
        async createComment(params: { body: string }) {
          postedBody = params.body;
          createdAt = postedId;
          return { data: { id: postedId } };
        },
        async updateComment(params: { body: string; comment_id: number }) {
          postedBody = params.body;
          return { data: { id: params.comment_id } };
        },
      },
    },
    getPosted() {
      if (postedBody === null) throw new Error('comment was not posted');
      return { body: postedBody, id: createdAt ?? postedId, mode: 'created' };
    },
    getUpdatedPrBody() {
      return updatedPrBody;
    },
  };
  return stub;
}

test('mvp — fixture: minimist 1.2.0 → 1.2.5 produces a CVE-matched comment', async () => {
  const stub = buildStubOctokit();
  const prCtx = {
    owner: 'demo',
    repo: 'demo',
    prNumber: 1,
    headSha: 'after',
    baseSha: 'before',
  };
  const inputs: Inputs = { githubToken: 'fake', commentMarker: COMMENT_MARKER };

  const { results, commentId } = await process(prCtx as never, stub as never, inputs);

  assert.equal(commentId, 17);
  assert.equal(results.length, 3);

  const minimist = results.find((r) => r.bump.name === 'minimist');
  const lodash = results.find((r) => r.bump.name === 'lodash');
  const safe = results.find((r) => r.bump.name === 'safe-pkg');
  assert.ok(minimist && lodash && safe);
  assert.equal(minimist.bump.from, '1.2.0');
  assert.equal(minimist.bump.to, '1.2.5');
  assert.equal(minimist.cves.length, 1);
  assert.equal(minimist.cves[0]?.id, 'GHSA-9m62-748x-fj5v');
  assert.deepEqual(minimist.cves[0]?.aliases, ['CVE-2021-44906']);

  // lodash 4.17.20 → 4.17.21 lands on the fixed version → no CVE match.
  assert.equal(lodash.cves.length, 0);
  assert.equal(safe.cves.length, 0);

  const body = stub.getPosted().body;

  // Comment starts with the marker, has the header, lists every bump in order,
  // cites the matching ids + aliases, and shows the "no CVE" line for the
  // negative cases.
  assert.ok(body.startsWith(COMMENT_MARKER));
  assert.match(body, /## Dependency bump CVE summary/);
  assert.match(body, /3 bumps analysed · 1 match known advisories ·/);
  assert.match(body, /### `minimist` `1\.2\.0` → `1\.2\.5`/);
  assert.match(body, /GHSA-9m62-748x-fj5v/);
  assert.match(body, /CVE-2021-44906/);
  assert.match(body, /### `lodash` `4\.17\.20` → `4\.17\.21`/);
  assert.match(body, /### `safe-pkg` `1\.0\.0` → `1\.2\.3`/);
  assert.match(body, /_No CVEs match the new version\._/);
});

test('mvp — second push updates the existing bivouac comment in place', async () => {
  const existingId = 99;
  const stub = buildStubOctokit({ existing: existingId });
  const prCtx = {
    owner: 'demo',
    repo: 'demo',
    prNumber: 1,
    headSha: 'after',
    baseSha: 'before',
  };
  const inputs: Inputs = { githubToken: 'fake', commentMarker: COMMENT_MARKER };

  const { commentId } = await process(prCtx as never, stub as never, inputs);

  // The action reuses the previously-marked comment rather than creating a
  // new one. The id returned is the one we synthesised in the listComments
  // stub.
  assert.equal(commentId, existingId);
  const body = stub.getPosted().body;
  assert.ok(body.startsWith(COMMENT_MARKER));
  assert.match(body, /## Dependency bump CVE summary/);
});

test('mvp — major-version crossing appends a PR-description warning block via pulls.update', async () => {
  // The mvp fixture normally avoids bumping a major, so to exercise the
  // PR-description wiring end-to-end we override the safe-pkg bump to cross a
  // major (1.x → 2.x). Without a reachable registry or GitHub releases, the
  // only finding produced by lookupBreakingChanges is the always-emitted
  // major-version-diff boundary row.
  const before =
    '{"name":"fixture","private":true,"dependencies":{"minimist":"1.2.0","safe-pkg-major":"1.9.0"}}';
  const after =
    '{"name":"fixture","private":true,"dependencies":{"minimist":"1.2.5","safe-pkg-major":"2.0.0"}}';
  const stub = ((): Stub => {
    let postedBody: string | null = null;
    let updatedPrBody: string | null = null;
    const postedId = 17;
    const out: Stub = {
      rest: {
        pulls: {
          async listFiles() {
            return { data: [{ filename: 'package.json', status: 'modified' }] };
          },
          async get() {
            return { data: { body: 'Existing PR description written by a human.' } };
          },
          async update(p: { body: string }) {
            updatedPrBody = p.body;
            return { data: undefined };
          },
        },
        repos: {
          async getContent(params: { ref: string }) {
            return {
              data: {
                content: Buffer.from(params.ref === 'before' ? before : after, 'utf8').toString(
                  'base64',
                ),
              },
            };
          },
        },
        issues: {
          async listComments() {
            return { data: [] };
          },
          async createComment(params: { body: string }) {
            postedBody = params.body;
            return { data: { id: postedId } };
          },
          async updateComment(params: { body: string; comment_id: number }) {
            postedBody = params.body;
            return { data: { id: params.comment_id } };
          },
        },
      },
      getPosted() {
        if (postedBody === null) throw new Error('comment was not posted');
        return { body: postedBody, id: postedId, mode: 'created' };
      },
      getUpdatedPrBody() {
        return updatedPrBody;
      },
    };
    return out;
  })();

  // Network calls in this fork are unrelated to the PR-description path — the
  // npm-registry call inside lookupBreakingChanges has its own try/catch and
  // fails closed. We deliberately do NOT install a fetch stub: the registration
  // entry's logic still runs, the test stays fast, and the assertion focus is
  // the wiring (process → appendPrWarnings → pulls.update).
  const originalFetch = (globalThis as { fetch?: unknown }).fetch;
  (globalThis as { fetch?: unknown }).fetch = (() =>
    Promise.reject(new Error('network disabled in mvp major-crossing test'))) as unknown;
  try {
    const prCtx = {
      owner: 'demo',
      repo: 'demo',
      prNumber: 1,
      headSha: 'after',
      baseSha: 'before',
    };
    const inputs: Inputs = { githubToken: 'fake', commentMarker: COMMENT_MARKER };
    const { results, prDescriptionUpdated, prWarningCount } = await process(
      prCtx as never,
      stub as never,
      inputs,
    );

    assert.equal(results.length, 2);
    const crossing = results.find((r) => r.bump.name === 'safe-pkg-major');
    assert.ok(crossing, 'safe-pkg-major bump present');
    assert.ok(crossing.breakingChanges.length >= 1, 'major-version-crossing yields a finding');

    // Without repo metadata the only signal is major-version-diff; without an
    // npm-registry response there are no marker findings. The wiring must
    // still light up the PR-description path because crossing.rows.length > 0.
    const updatedBody = stub.getUpdatedPrBody();
    assert.ok(updatedBody !== null, 'pulls.update was invoked');
    assert.ok(
      updatedBody?.startsWith('Existing PR description written by a human.'),
      'human-written body is preserved before the warning block',
    );
    assert.ok(updatedBody?.includes('bivouac-action:pr-warnings:start'));
    assert.ok(updatedBody?.includes('bivouac-action:pr-warnings:end'));
    assert.ok(updatedBody?.includes('safe-pkg-major'));
    assert.equal(prDescriptionUpdated, true);
    assert.ok(prWarningCount >= 1);
  } finally {
    if (originalFetch === undefined) {
      delete (globalThis as { fetch?: unknown }).fetch;
    } else {
      (globalThis as { fetch?: unknown }).fetch = originalFetch;
    }
  }
});
