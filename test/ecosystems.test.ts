import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  detectBumps,
  detectGoBumps,
  detectNpmBumps,
  detectNpmLockBumps,
  detectPipBumps,
  ecosystemForPath,
  mergeBumps,
  toSemver,
} from '../src/ecosystems';

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

test('ecosystemForPath — maps supported manifests and lockfiles', () => {
  assert.equal(ecosystemForPath('package.json'), 'npm');
  assert.equal(ecosystemForPath('src/foo/package.json'), 'npm');
  assert.equal(ecosystemForPath('package-lock.json'), 'npm');
  assert.equal(ecosystemForPath('npm-shrinkwrap.json'), 'npm');
  assert.equal(ecosystemForPath('requirements.txt'), 'pip');
  assert.equal(ecosystemForPath('requirements-dev.txt'), 'pip');
  assert.equal(ecosystemForPath('poetry.lock'), 'pip');
  assert.equal(ecosystemForPath('uv.lock'), 'pip');
  assert.equal(ecosystemForPath('go.mod'), 'go');
  assert.equal(ecosystemForPath('go.sum'), null);
  assert.equal(ecosystemForPath('Cargo.toml'), null);
  assert.equal(ecosystemForPath('Gemfile'), null);
  assert.equal(ecosystemForPath('CHANGELOG.md'), null);
});

test('toSemver — pads short versions and strips a leading v', () => {
  assert.equal(toSemver('2.31'), '2.31.0');
  assert.equal(toSemver('v0.17.0'), '0.17.0');
  assert.equal(toSemver('2.0.0rc1'), null);
});

test('detectNpmLockBumps — v3 lockfile, transitive and nested copies', () => {
  const before = JSON.stringify({
    lockfileVersion: 3,
    packages: {
      '': { dependencies: { express: '^4.18.2' } },
      'node_modules/express': { version: '4.18.2' },
      'node_modules/qs': { version: '6.11.0' },
      'node_modules/body-parser/node_modules/qs': { version: '6.10.0' },
      'node_modules/@scope/pkg': { version: '1.0.0' },
    },
  });
  const after = JSON.stringify({
    lockfileVersion: 3,
    packages: {
      '': { dependencies: { express: '^4.18.2' } },
      'node_modules/express': { version: '4.21.2' },
      'node_modules/qs': { version: '6.13.0' },
      'node_modules/body-parser/node_modules/qs': { version: '6.13.0' },
      'node_modules/@scope/pkg': { version: '1.0.0' },
      'node_modules/new-dep': { version: '1.0.0' },
    },
  });
  const bumps = detectNpmLockBumps(before, after);
  const byName = Object.fromEntries(bumps.map((b) => [b.name, b]));
  assert.equal(bumps.length, 2);
  assert.deepEqual([byName.express?.from, byName.express?.to, byName.express?.direct], ['4.18.2', '4.21.2', true]);
  assert.deepEqual([byName.qs?.from, byName.qs?.to, byName.qs?.direct], ['6.11.0', '6.13.0', false]);
});

test('detectNpmLockBumps — v1 lockfile', () => {
  const before = JSON.stringify({ lockfileVersion: 1, dependencies: { minimist: { version: '1.2.0' } } });
  const after = JSON.stringify({ lockfileVersion: 1, dependencies: { minimist: { version: '1.2.8' } } });
  const bumps = detectNpmLockBumps(before, after);
  assert.equal(bumps[0]?.to, '1.2.8');
});

test('detectPipBumps — requirements.txt with extras, markers and comments', () => {
  const before = 'requests==2.31.0\nDjango[argon2]==4.2.0 ; python_version >= "3.8"\n# comment\n-r base.txt\nflask>=2.0\n';
  const after = 'requests==2.32.3  # pinned\nDjango[argon2]==4.2.16 ; python_version >= "3.8"\nflask>=2.0\n';
  const bumps = detectPipBumps('requirements.txt', before, after);
  assert.deepEqual(
    bumps.map((b) => `${b.name}:${b.from}->${b.to}`),
    ['requests:2.31.0->2.32.3', 'django:4.2.0->4.2.16'],
  );
  assert.ok(bumps.every((b) => b.ecosystem === 'pip'));
});

test('detectPipBumps — poetry.lock / uv.lock package tables', () => {
  const lock = (v: string) =>
    `[[package]]\nname = "Jinja2"\nversion = "${v}"\n\n[[package]]\nname = "markupsafe"\nversion = "2.1.5"\n`;
  const bumps = detectPipBumps('poetry.lock', lock('3.1.3'), lock('3.1.6'));
  assert.deepEqual(bumps.map((b) => [b.name, b.from, b.to]), [['jinja2', '3.1.3', '3.1.6']]);
});

test('detectGoBumps — require block and single-line require, indirect flag', () => {
  const before = 'module x\n\ngo 1.22\n\nrequire (\n\tgolang.org/x/net v0.17.0\n\tgithub.com/gin-gonic/gin v1.9.0 // indirect\n)\nrequire github.com/stretchr/testify v1.8.0\n';
  const after = 'module x\n\ngo 1.22\n\nrequire (\n\tgolang.org/x/net v0.33.0\n\tgithub.com/gin-gonic/gin v1.10.0 // indirect\n)\nrequire github.com/stretchr/testify v1.8.0\n';
  const bumps = detectGoBumps(before, after);
  assert.deepEqual(
    bumps.map((b) => [b.name, b.from, b.to, b.direct]),
    [
      ['golang.org/x/net', 'v0.17.0', 'v0.33.0', true],
      ['github.com/gin-gonic/gin', 'v1.9.0', 'v1.10.0', false],
    ],
  );
});

test('mergeBumps — lockfile versions win over package.json, direct flag kept', () => {
  const manifest = detectBumps(
    'package.json',
    JSON.stringify({ dependencies: { axios: '^1.5.0' } }),
    JSON.stringify({ dependencies: { axios: '^1.6.0' } }),
  );
  const lock = detectBumps(
    'package-lock.json',
    JSON.stringify({ packages: { '': {}, 'node_modules/axios': { version: '1.5.1' } } }),
    JSON.stringify({ packages: { '': {}, 'node_modules/axios': { version: '1.6.8' } } }),
  );
  const merged = mergeBumps([...manifest, ...lock]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.to, '1.6.8');
  assert.equal(merged[0]?.file, 'package-lock.json');
  assert.equal(merged[0]?.direct, true);
});
