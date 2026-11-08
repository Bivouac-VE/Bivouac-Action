// Unit tests for the PR-description warning block. Stubs pulls.get / pulls.update
// on an OctokitLike-shaped object, then drives appendPrWarnings against a few
// canned bump results. No real GitHub API calls.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appendPrWarnings } from '../src/pr-description';
import type { BumpResult } from '../src/types';

const CTX = { owner: 'demo', repo: 'demo', prNumber: 1 };

function makeFinding(overrides: Partial<BumpResult['bump']> = {}): BumpResult {
  return {
    bump: {
      name: overrides.name ?? 'lodash',
      from: overrides.from ?? '4.16.0',
      to: overrides.to ?? '5.0.0',
      ecosystem: 'npm' as const,
    },
    cves: [],
    breakingChanges: [
      {
        version: '5.0.0',
        source: 'github-releases' as const,
        category: 'behavior' as const,
        summary: 'BREAKING: rename .remove to .delete across the core tree.',
        migrationNote: 'use lodash.delete instead of lodash.remove',
        url: 'https://github.com/lodash/lodash/releases/tag/5.0.0',
        markers: ['BREAKING', 'deprecated'],
      },
      {
        version: '5.0.0',
        source: 'major-version-diff' as const,
        category: 'behavior' as const,
        summary: 'Major-version boundary',
        migrationNote: 'Read upstream major-version diff for migration notes.',
        url: 'https://github.com/lodash/lodash/releases/tag/v5.0.0',
        markers: ['major'],
      },
    ],
  };
}

function buildOctokit(opts: { prBody?: string; throws?: boolean } = {}) {
  let updatedBody: string | null = null;
  let getCalls = 0;
  let updateCalls = 0;
  const octokit = {
    rest: {
      pulls: {
        async get(_params: { owner: string; repo: string; pull_number: number }) {
          getCalls += 1;
          if (opts.throws) throw new Error('pulls.get exploded');
          return { data: { body: opts.prBody ?? '' } };
        },
        async update(params: { owner: string; repo: string; pull_number: number; body: string }) {
          updateCalls += 1;
          updatedBody = params.body;
          return { data: undefined };
        },
      },
    },
    calls() {
      return { getCalls, updateCalls };
    },
    lastUpdate() {
      return updatedBody;
    },
  };
  return octokit;
}

test('pr-description — writes a warning block to the PR body when findings exist', async () => {
  const octokit = buildOctokit({ prBody: 'My awesome PR description.' });
  const res = await appendPrWarnings(octokit as never, CTX, [makeFinding()]);

  assert.equal(res.updated, true);
  assert.equal(res.warningCount, 2);
  const body = octokit.lastUpdate();
  assert.ok(body !== null, 'pulls.update was called');
  assert.ok(body?.startsWith('My awesome PR description.'), 'human-written body preserved');
  assert.ok(body?.includes('⚠️ Breaking change warnings (bivouac-action)'));
  assert.ok(body?.includes('### `lodash` `4.16.0` → `5.0.0`'));
  assert.ok(
    body?.includes('BREAKING: rename .remove to .delete across the core tree.'),
    'quoted upstream summary present',
  );
  assert.ok(
    body?.includes('https://github.com/lodash/lodash/releases/tag/5.0.0'),
    'upstream URL present',
  );
  assert.ok(body?.includes('use lodash.delete instead of lodash.remove'));
  assert.ok(body?.includes('Major-version boundary'));
  assert.match(body ?? '', /<!-- bivouac-action:pr-warnings:start -->/);
  assert.match(body ?? '', /<!-- bivouac-action:pr-warnings:end -->/);
});

test('pr-description — second run replaces the block, never duplicates', async () => {
  // First call writes a body that already contains a warning block, so the
  // second call must strip it before re-splicing a fresh one.
  const initialBlock =
    'Pre-existing\n\n<!-- bivouac-action:pr-warnings:start -->\n## ⚠️ Breaking change warnings (bivouac-action)\n\nold content\n<!-- bivouac-action:pr-warnings:end -->';
  const octokit = buildOctokit({ prBody: initialBlock });

  const res = await appendPrWarnings(octokit as never, CTX, [
    makeFinding({ name: 'axios', from: '0.27.0', to: '1.0.0' }),
  ]);

  assert.equal(res.updated, true);
  const body = octokit.lastUpdate();
  assert.ok(body !== null);
  // Exactly one start marker, exactly one end marker — the old sandwich was
  // stripped before the new one was spliced in.
  const startMatches = body?.match(/<!-- bivouac-action:pr-warnings:start -->/g) ?? [];
  const endMatches = body?.match(/<!-- bivouac-action:pr-warnings:end -->/g) ?? [];
  assert.equal(startMatches.length, 1, 'exactly one start marker');
  assert.equal(endMatches.length, 1, 'exactly one end marker');
  assert.ok(!body?.includes('old content'), 'previous block content was replaced');
  assert.ok(body?.startsWith('Pre-existing'), 'user content above the markers preserved');
});

test('pr-description — does nothing when there are no breaking changes', async () => {
  const octokit = buildOctokit();
  const noFindings: BumpResult[] = [
    {
      bump: { name: 'safe-pkg', from: '1.0.0', to: '1.0.1', ecosystem: 'npm' },
      cves: [],
      breakingChanges: [],
    },
  ];

  const res = await appendPrWarnings(octokit as never, CTX, noFindings);
  assert.deepEqual(res, { updated: false, warningCount: 0 });
  assert.equal(octokit.calls().getCalls, 0);
  assert.equal(octokit.calls().updateCalls, 0);
});

test('pr-description — does not throw when pulls.get rejects', async () => {
  const octokit = buildOctokit({ throws: true });
  const res = await appendPrWarnings(octokit as never, CTX, [makeFinding()]);
  // The catch path swallows the network failure and returns a structured
  // { updated: false, reason, warningCount } envelope — never throws past the
  // module boundary so a downstream test-run still executes.
  assert.equal(res.updated, false);
  assert.ok(typeof res.reason === 'string' && res.reason.length > 0);
  assert.ok(res.reason.includes('pulls.get exploded'));
  assert.equal(res.warningCount, 2);
  assert.equal(octokit.calls().updateCalls, 0, 'failed get → no update call');
});
