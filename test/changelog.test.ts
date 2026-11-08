// Fixture tests for the changelog / breaking-change detector. Each test stubs
// the globalThis fetch + octokit.request path used by lookupBreakingChanges,
// then drives process() against a synthesised package.json diff.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COMMENT_MARKER, process } from '../src/index';
import type { Inputs } from '../src/types';

const LODASH_BEFORE = '{"name":"fixture","private":true,"dependencies":{"lodash":"4.16.0"}}';
const LODASH_AFTER = '{"name":"fixture","private":true,"dependencies":{"lodash":"5.0.0"}}';

const RELEASES_BREAKING = [
  {
    tag_name: '5.0.0',
    body: [
      '# 5.0.0',
      '',
      'BREAKING: rename .remove to .delete across the core tree.',
      'deprecated API removedForEach is gone.',
    ].join('\n'),
    html_url: 'https://github.com/lodash/lodash/releases/tag/5.0.0',
  },
];

const RELEASES_NO_MARKERS = [
  {
    tag_name: '5.0.0',
    body: '# 5.0.0\n\nBug fixes only.',
    html_url: 'https://github.com/lodash/lodash/releases/tag/5.0.0',
  },
];

// CHANGELOG fixture: a single 5.0.0 section carrying both a "removed" line and
// a "deprecated" line — used by the 4th test to confirm the
// CHANGELOG.md-source path is exercised end-to-end.
const CHANGELOG_MD_LODASH_5 = [
  '# Changelog',
  '',
  '## 5.0.0',
  '',
  'Removed: lodash.remove is gone — use lodash.pull instead.',
  'Deprecated: removedForEach is marked for removal in the next major.',
  '',
  '## 4.17.21',
  '',
  '- Bug fixes only.',
].join('\n');

interface GitHubRelease {
  tag_name: string;
  body: string;
  html_url: string;
}

interface Stub {
  rest: {
    pulls: {
      listFiles: () => Promise<{ data: Array<{ filename: string; status: string }> }>;
      get: () => Promise<{ data: { body: string } }>;
      update: (p: { body: string }) => Promise<{ data: unknown }>;
    };
    repos: {
      getContent: (p: { ref: string; path: string }) => Promise<{ data: { content: string } }>;
    };
    issues: {
      listComments: () => Promise<{ data: Array<{ id: number; body?: string | null }> }>;
      createComment: (p: { body: string }) => Promise<{ data: { id: number } }>;
      updateComment: (p: { body: string; comment_id: number }) => Promise<{ data: { id: number } }>;
    };
  };
  request: (route: string, params?: unknown) => Promise<{ data: unknown }>;
  getPosted(): { body: string };
  getUpdatedPrBody(): string | null;
}

interface StubOptions {
  changelog?: string | null;
  prBody?: string;
}

function buildStub(releases: GitHubRelease[], opts: StubOptions = {}): Stub {
  const postedBodies: string[] = [];
  const updatedPrBodies: string[] = [];
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
          updatedPrBodies.push(params.body);
          return { data: undefined };
        },
      },
      repos: {
        async getContent(params: { ref: string; path: string }) {
          if (params.path === 'CHANGELOG.md') {
            if (opts.changelog === null) {
              throw new Error('CHANGELOG.md 404');
            }
            const body = opts.changelog ?? '';
            return { data: { content: Buffer.from(body, 'utf8').toString('base64') } };
          }
          const content = params.ref === 'before' ? LODASH_BEFORE : LODASH_AFTER;
          return { data: { content: Buffer.from(content, 'utf8').toString('base64') } };
        },
      },
      issues: {
        async listComments() {
          return { data: [] };
        },
        async createComment(params: { body: string }) {
          postedBodies.push(params.body);
          return { data: { id: 17 } };
        },
        async updateComment(params: { body: string; comment_id: number }) {
          postedBodies.push(params.body);
          return { data: { id: params.comment_id } };
        },
      },
    },
    request(_route: string, _params?: unknown) {
      return Promise.resolve({ data: releases });
    },
    getPosted() {
      const body = postedBodies[postedBodies.length - 1];
      if (body === undefined) throw new Error('comment was not posted');
      return { body };
    },
    getUpdatedPrBody() {
      return updatedPrBodies[updatedPrBodies.length - 1] ?? null;
    },
  };
  return stub;
}

function installFetchStub(builder: () => Promise<Response>): { restore: () => void } {
  const original = (globalThis as { fetch?: unknown }).fetch;
  (globalThis as { fetch?: unknown }).fetch = builder;
  return {
    restore() {
      if (original === undefined) {
        delete (globalThis as { fetch?: unknown }).fetch;
      } else {
        (globalThis as { fetch?: unknown }).fetch = original;
      }
    },
  };
}

test('breaking — lodash 4.16.0 → 5.0.0 surfaces quoted + linked breaking-change entry', async () => {
  const stub = buildStub(RELEASES_BREAKING);

  const fetcher = installFetchStub(async () => {
    return new Response(
      JSON.stringify({
        repository: { url: 'https://github.com/lodash/lodash' },
        time: {
          '4.16.0': '2016-09-30T00:00:00.000Z',
          '5.0.0': '2020-05-13T00:00:00.000Z',
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  });

  try {
    const prCtx = {
      owner: 'demo',
      repo: 'demo',
      prNumber: 1,
      headSha: 'after',
      baseSha: 'before',
    };
    const inputs: Inputs = { githubToken: 'fake', commentMarker: COMMENT_MARKER };

    const { results } = await process(prCtx as never, stub as never, inputs);

    const lodash = results.find((r) => r.bump.name === 'lodash');
    assert.ok(lodash, 'lodash bump should be present');
    // 5.0.0 is a major-version boundary (4 → 5), so we always get the
    // major-version-diff finding in addition to the release-notes finding.
    assert.ok(lodash.breakingChanges.length >= 1);
    const bc = lodash.breakingChanges[0];
    if (!bc) throw new Error('expected first breaking-change finding');
    assert.equal(bc.version, '5.0.0');
    assert.equal(bc.source, 'github-releases');
    assert.equal(bc.url, 'https://github.com/lodash/lodash/releases/tag/5.0.0');
    assert.ok(bc.markers.includes('BREAKING'), 'BREAKING marker present');
    assert.ok(bc.markers.includes('deprecated'), 'deprecated marker present');
    assert.ok(
      bc.summary.toLowerCase().includes('breaking') || bc.summary.includes('rename'),
      'summary quotes a marker line',
    );
    assert.ok(bc.migrationNote.length > 0, 'migrationNote is a non-empty one-liner');

    const body = stub.getPosted().body;
    assert.ok(body.startsWith(COMMENT_MARKER));
    assert.ok(body.includes('BREAKING: rename .remove to .delete'));
    assert.ok(body.includes('https://github.com/lodash/lodash/releases/tag/5.0.0'));
    assert.ok(body.includes('5.0.0'));
    assert.ok(body.includes('Release notes'));
    assert.match(body, /> _Migration:_ \*\*[^*]+\*\*/);
  } finally {
    fetcher.restore();
  }
});

test('breaking — release note without BREAKING marker still emits major-version-diff boundary', async () => {
  // 4.16.0 → 5.0.0 — bump crosses a major, so even when the upstream release
  // notes lack a marker, the major-version-diff boundary surface is rendered.
  const stub = buildStub(RELEASES_NO_MARKERS);

  const fetcher = installFetchStub(async () => {
    return new Response(
      JSON.stringify({
        repository: { url: 'https://github.com/lodash/lodash' },
        time: {
          '4.16.0': '2016-09-30T00:00:00.000Z',
          '5.0.0': '2020-05-13T00:00:00.000Z',
        },
      }),
      { status: 200 },
    );
  });

  try {
    const inputs: Inputs = { githubToken: 'fake', commentMarker: COMMENT_MARKER };
    const prCtx = { owner: 'demo', repo: 'demo', prNumber: 1, headSha: 'after', baseSha: 'before' };
    const { results } = await process(prCtx as never, stub as never, inputs);

    const lodash = results.find((r) => r.bump.name === 'lodash');
    assert.ok(lodash);
    // The release notes lack a marker but the bump crosses a major version,
    // so the major-version-diff surface always lights up — there is at least
    // one boundary finding.
    assert.ok(lodash.breakingChanges.length >= 1);
    const majorBoundary = lodash.breakingChanges.find((f) => f.source === 'major-version-diff');
    assert.ok(majorBoundary, 'major-version-diff finding present');
    assert.equal(majorBoundary.category, 'behavior');
    assert.equal(majorBoundary.version, '5.0.0');
    assert.ok(majorBoundary.migrationNote.length > 0);

    const body = stub.getPosted().body;
    assert.ok(body.includes('Major-version diff'));
    assert.ok(body.includes('Major-version boundary'));
    assert.ok(!body.includes('releases/tag/5.0.0'));
  } finally {
    fetcher.restore();
  }
});

test('breaking — npm-registry fetch rejection does not throw', async () => {
  const stub = buildStub(RELEASES_BREAKING);

  const fetcher = installFetchStub(async () => {
    throw new Error('ECONNRESET — npm unreachable');
  });

  try {
    const inputs: Inputs = { githubToken: 'fake', commentMarker: COMMENT_MARKER };
    const prCtx = { owner: 'demo', repo: 'demo', prNumber: 1, headSha: 'after', baseSha: 'before' };
    const { results } = await process(prCtx as never, stub as never, inputs);

    assert.equal(results.length, 1);
    // npm unreachable ⇒ no `release-notes` findings; but the 4→5 bump still
    // surfaces the major-version-diff boundary.
    const lodash = results[0];
    if (!lodash) throw new Error('expected one bump result');
    assert.equal(lodash.bump.name, 'lodash');
    assert.equal(lodash.breakingChanges.length, 1);
    const bc = lodash.breakingChanges[0];
    if (!bc) throw new Error('expected major-version-diff finding');
    assert.equal(bc.source, 'major-version-diff');

    const body = stub.getPosted().body;
    assert.ok(body.startsWith(COMMENT_MARKER));
    assert.match(body, /## Dependency bump CVE summary/);
  } finally {
    fetcher.restore();
  }
});

test('breaking — CHANGELOG.md 5.0.0 section contributes removed + deprecated findings', async () => {
  const stub = buildStub(RELEASES_BREAKING, { changelog: CHANGELOG_MD_LODASH_5 });

  const fetcher = installFetchStub(async () => {
    return new Response(
      JSON.stringify({
        repository: { url: 'https://github.com/lodash/lodash' },
        time: {
          '4.16.0': '2016-09-30T00:00:00.000Z',
          '5.0.0': '2020-05-13T00:00:00.000Z',
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  });

  try {
    const prCtx = { owner: 'demo', repo: 'demo', prNumber: 1, headSha: 'after', baseSha: 'before' };
    const inputs: Inputs = { githubToken: 'fake', commentMarker: COMMENT_MARKER };
    const { results } = await process(prCtx as never, stub as never, inputs);

    const lodash = results.find((r) => r.bump.name === 'lodash');
    assert.ok(lodash);

    // At least one CHANGELOG.md-sourced 'removed' finding must light up.
    const removed = lodash.breakingChanges.find((f) => f.category === 'removed');
    assert.ok(removed, 'removed-category finding present');
    assert.ok(removed?.markers.includes('removed'));
    assert.ok(removed?.migrationNote.length > 0);

    const body = stub.getPosted().body;
    assert.ok(body.includes('CHANGELOG.md'));
  } finally {
    fetcher.restore();
  }
});

test('breaking — major bump emits a behavior-category major-version-diff finding', async () => {
  // The lodash 4.16.0 → 5.0.0 bump in this fixture crosses a major boundary;
  // the release body has no BREAKING marker. The boundary surface is the
  // major-version-diff finding.
  const stub = buildStub(RELEASES_NO_MARKERS);

  const fetcher = installFetchStub(async () => {
    return new Response(
      JSON.stringify({
        repository: { url: 'https://github.com/lodash/lodash' },
        time: {
          '4.16.0': '2016-09-30T00:00:00.000Z',
          '5.0.0': '2020-05-13T00:00:00.000Z',
        },
      }),
      { status: 200 },
    );
  });

  try {
    const inputs: Inputs = { githubToken: 'fake', commentMarker: COMMENT_MARKER };
    const prCtx = { owner: 'demo', repo: 'demo', prNumber: 1, headSha: 'after', baseSha: 'before' };
    const { results } = await process(prCtx as never, stub as never, inputs);

    const lodash = results.find((r) => r.bump.name === 'lodash');
    assert.ok(lodash);
    // Major-major bump ⇒ major-version-diff finding only, no release-notes
    // source. category is "behavior".
    const majorFindings = lodash?.breakingChanges.filter((f) => f.source === 'major-version-diff');
    assert.equal(majorFindings.length, 1);
    assert.equal(majorFindings[0]?.category, 'behavior');
    assert.equal(majorFindings[0]?.version, '5.0.0');
    assert.ok(majorFindings[0]?.migrationNote.length > 0);
  } finally {
    fetcher.restore();
  }
});

test('breaking — release-notes pass still produces markers array containing BREAKING (back-compat)', async () => {
  // The legacy BreakingChangeRef-shape 'markers' property is preserved on the
  // per-finding object so downstream consumers of `breaking-summary` keep
  // working.
  const stub = buildStub(RELEASES_BREAKING);

  const fetcher = installFetchStub(async () => {
    return new Response(
      JSON.stringify({
        repository: { url: 'https://github.com/lodash/lodash' },
        time: {
          '4.16.0': '2016-09-30T00:00:00.000Z',
          '5.0.0': '2020-05-13T00:00:00.000Z',
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  });

  try {
    const inputs: Inputs = { githubToken: 'fake', commentMarker: COMMENT_MARKER };
    const prCtx = { owner: 'demo', repo: 'demo', prNumber: 1, headSha: 'after', baseSha: 'before' };
    const { results } = await process(prCtx as never, stub as never, inputs);

    const lodash = results.find((r) => r.bump.name === 'lodash');
    assert.ok(lodash);
    const releaseNotesFindings = lodash?.breakingChanges.filter(
      (f) => f.source === 'github-releases',
    );
    assert.ok(releaseNotesFindings.length > 0);
    assert.ok(releaseNotesFindings[0]?.markers.includes('BREAKING'));
  } finally {
    fetcher.restore();
  }
});
