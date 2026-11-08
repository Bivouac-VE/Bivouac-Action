import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COMMENT_MARKER, findExistingComment, markerFor } from '../src/state';

test('findExistingComment — returns most recent matching comment', async () => {
  const octokit = {
    rest: {
      issues: {
        async listComments() {
          return {
            data: [
              { id: 1, body: 'just a normal comment' },
              { id: 2, body: `${COMMENT_MARKER}\nold` },
              { id: 3, body: 'third-party' },
              { id: 4, body: `${COMMENT_MARKER}\nnewer` },
            ],
          };
        },
      },
    },
  };
  const out = await findExistingComment(octokit, 'o', 'r', 1);
  assert.ok(out);
  assert.equal(out?.id, 4);
  assert.match(out?.body ?? '', /newer/);
});

test('findExistingComment — returns null when no marker present', async () => {
  const octokit = {
    rest: {
      issues: {
        async listComments() {
          return {
            data: [
              { id: 1, body: 'something else' },
              { id: 2, body: 'another comment' },
            ],
          };
        },
      },
    },
  };
  const out = await findExistingComment(octokit, 'o', 'r', 1);
  assert.equal(out, null);
});

test('markerFor — empty input returns default', () => {
  assert.equal(markerFor(''), COMMENT_MARKER);
  assert.equal(markerFor('   '), COMMENT_MARKER);
});

test('markerFor — non-empty input is trimmed and preserved', () => {
  assert.equal(markerFor('<!-- custom -->'), '<!-- custom -->');
  assert.equal(markerFor('  <!-- custom -->  '), '<!-- custom -->');
});

test('findExistingComment — uses custom marker for round-trip', async () => {
  let listedWith: { owner: string; repo: string; issue_number: number; per_page?: number } = {
    owner: '',
    repo: '',
    issue_number: 0,
  };
  let matched: { id: number; body: string } = { id: 0, body: '' };
  const octokit = {
    rest: {
      issues: {
        async listComments(params: {
          owner: string;
          repo: string;
          issue_number: number;
          per_page?: number;
        }) {
          listedWith = params;
          return {
            data: [
              { id: 7, body: '<!-- other-action -->\nhi' },
              { id: 9, body: '<!-- my-marker -->\nbody' },
            ],
          };
        },
      },
    },
  };
  matched = (await findExistingComment(octokit, 'o', 'r', 42, '<!-- my-marker -->')) as {
    id: number;
    body: string;
  };
  assert.equal(listedWith.owner, 'o');
  assert.equal(listedWith.repo, 'r');
  assert.equal(listedWith.issue_number, 42);
  assert.equal(listedWith.per_page, 100);
  assert.equal(matched.id, 9);
  assert.match(matched.body, /my-marker/);
});
