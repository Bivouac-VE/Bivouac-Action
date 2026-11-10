import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderComment } from '../src/comment';
import { COMMENT_MARKER } from '../src/state';
import type { BumpResult } from '../src/types';

test('renderComment — empty bumps shows no-bumps message', () => {
  const body = renderComment([]);
  assert.ok(body.startsWith(COMMENT_MARKER));
  assert.ok(body.includes('No dependency bumps detected'));
  assert.ok(!body.includes('### `'));
});

test('renderComment — renders one section per bump with CVE table', () => {
  const results: BumpResult[] = [
    {
      bump: { name: 'lodash', from: '4.17.20', to: '4.17.21', ecosystem: 'npm' },
      cves: [
        {
          id: 'GHSA-p6mc-m468-83gx',
          summary: 'Command injection via lodash template function',
          severity: 'high',
          aliases: ['CVE-2021-23337'],
          fixedVersions: ['4.17.21'],
        },
      ],
      breakingChanges: [],
    },
    {
      bump: { name: 'safe-pkg', from: '1.0.0', to: '1.2.3', ecosystem: 'npm' },
      cves: [],
      breakingChanges: [],
    },
  ];
  const body = renderComment(results);
  assert.ok(body.startsWith(COMMENT_MARKER));
  assert.match(body, /## Dependency bump CVE summary/);
  assert.match(body, /### `lodash` `4\.17\.20` → `4\.17\.21`/);
  assert.match(body, /GHSA-p6mc-m468-83gx/);
  assert.match(body, /CVE-2021-23337/);
  assert.match(body, /### `safe-pkg` `1\.0\.0` → `1\.2\.3`/);
  assert.match(body, /_No known advisories affect the new version\._/);
  assert.match(body, /2 bumps analysed · 0 advisory\(ies\) fixed · 1 still vulnerable ·/);
});

test('renderComment — singular bump phrasing', () => {
  const results: BumpResult[] = [
    {
      bump: { name: 'minimist', from: '1.2.0', to: '1.2.5', ecosystem: 'npm' },
      cves: [
        {
          id: 'GHSA-9m62-748x-fj5v',
          summary: 'Prototype pollution',
          severity: 'critical',
          aliases: ['CVE-2021-44906'],
          fixedVersions: ['1.2.6'],
        },
      ],
      breakingChanges: [],
    },
  ];
  const body = renderComment(results);
  assert.match(body, /1 bump analysed · 0 advisory\(ies\) fixed · 1 still vulnerable ·/);
});

test('renderComment — per-bump breaking-change section includes migration note', () => {
  const results: BumpResult[] = [
    {
      bump: { name: 'lodash', from: '4.16.0', to: '5.0.0', ecosystem: 'npm' },
      cves: [],
      breakingChanges: [
        {
          version: '5.0.0',
          source: 'github-releases',
          category: 'behavior',
          summary: 'BREAKING: rename .remove to .delete',
          migrationNote: 'Use .delete going forward.',
          url: 'https://github.com/lodash/lodash/releases/tag/5.0.0',
          markers: ['BREAKING', 'removed'],
        },
      ],
    },
  ];
  const body = renderComment(results);
  assert.match(body, /> _Migration:_ \*\*Use \.delete going forward\.\*\*/);
  assert.match(body, /\(1 finding\(s\) flagged\)/);
  assert.match(body, /Release notes/);
});

test('renderComment — fixed advisories and lookup failures are shown', () => {
  const results: BumpResult[] = [
    {
      bump: { name: 'axios', from: '1.5.0', to: '1.6.0', ecosystem: 'npm' },
      cves: [],
      fixes: [
        {
          id: 'GHSA-wf5p-g6vw-rhxx',
          summary: 'Axios Cross-Site Request Forgery Vulnerability',
          severity: 'medium',
          aliases: ['CVE-2023-45857'],
          fixedVersions: ['1.6.0'],
          url: 'https://github.com/advisories/GHSA-wf5p-g6vw-rhxx',
        },
      ],
      breakingChanges: [],
    },
    {
      bump: { name: 'left-pad', from: '1.0.0', to: '1.1.0', ecosystem: 'npm' },
      cves: [],
      advisoryLookupFailed: true,
      breakingChanges: [],
    },
  ];
  const body = renderComment(results);
  assert.match(body, /Fixed by this bump\*\* \(1 advisory\(ies\)\)/);
  assert.match(body, /\[`GHSA-wf5p-g6vw-rhxx`\]\(https:\/\/github\.com\/advisories\/GHSA-wf5p-g6vw-rhxx\)/);
  assert.match(body, /Could not reach the GitHub Advisory Database/);
  assert.match(body, /2 bumps analysed · 1 advisory\(ies\) fixed · 0 still vulnerable ·/);
});
