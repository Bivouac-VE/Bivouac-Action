import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectNpmBumps, ecosystemForPath } from '../src/ecosystems';

test('detectNpmBumps — finds a bumped dependency', () => {
  const before = JSON.stringify({
    dependencies: { lodash: '^4.17.20' },
    devDependencies: { typescript: '^5.0.0' },
  });
  const after = JSON.stringify({
    dependencies: { lodash: '^4.17.21' },
    devDependencies: { typescript: '^5.0.0' },
  });
  const bumps = detectNpmBumps(before, after);
  assert.equal(bumps.length, 1);
  assert.equal(bumps[0]?.name, 'lodash');
  assert.equal(bumps[0]?.from, '4.17.20');
  assert.equal(bumps[0]?.to, '4.17.21');
  assert.equal(bumps[0]?.ecosystem, 'npm');
});

test('detectNpmBumps — ignores downgrades', () => {
  const before = JSON.stringify({ dependencies: { axios: '1.6.7' } });
  const after = JSON.stringify({ dependencies: { axios: '1.6.6' } });
  assert.equal(detectNpmBumps(before, after).length, 0);
});

test('detectNpmBumps — picks up peerDependencies bumps', () => {
  const before = JSON.stringify({ peerDependencies: { react: '18.2.0' } });
  const after = JSON.stringify({ peerDependencies: { react: '19.0.0' } });
  const bumps = detectNpmBumps(before, after);
  assert.equal(bumps.length, 1);
  assert.equal(bumps[0]?.name, 'react');
  assert.equal(bumps[0]?.to, '19.0.0');
});

test('detectNpmBumps — invalid JSON returns nothing', () => {
  assert.equal(detectNpmBumps('not json', '{"dependencies":{"x":"1.0.0"}}').length, 0);
});

test('ecosystemForPath — package.json maps to npm; everything else is null', () => {
  assert.equal(ecosystemForPath('package.json'), 'npm');
  assert.equal(ecosystemForPath('src/foo/package.json'), 'npm');
  assert.equal(ecosystemForPath('requirements.txt'), null);
  assert.equal(ecosystemForPath('Cargo.toml'), null);
  assert.equal(ecosystemForPath('Gemfile'), null);
  assert.equal(ecosystemForPath('go.mod'), null);
  assert.equal(ecosystemForPath('package-lock.json'), null);
  assert.equal(ecosystemForPath('CHANGELOG.md'), null);
});
