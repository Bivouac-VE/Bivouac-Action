import semver from 'semver';
import type { Bump, Ecosystem } from './types';

// ---------------------------------------------------------------------------
// Version helpers
// ---------------------------------------------------------------------------

/**
 * Normalise a version string from any supported ecosystem into a plain
 * semver triple for ordering. Returns null for versions we can't order
 * safely (e.g. Python pre-releases like 2.0.0rc1, Go pseudo-versions).
 */
export function toSemver(version: string): string | null {
  const v = version.trim().replace(/^v/, '');
  const direct = semver.valid(v);
  if (direct) return direct;
  const m = v.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/);
  if (!m) return null;
  return semver.valid(`${m[1]}.${m[2] ?? '0'}.${m[3] ?? '0'}`);
}

function isUpgrade(from: string, to: string): boolean {
  const a = toSemver(from);
  const b = toSemver(to);
  if (!a || !b) return false;
  return semver.gt(b, a);
}

/** PyPI canonical name: lower-case, runs of -_. become a single hyphen. */
export function normalizePyName(name: string): string {
  return name.trim().toLowerCase().replace(/[-_.]+/g, '-');
}

// ---------------------------------------------------------------------------
// npm: package.json
// ---------------------------------------------------------------------------

const NPM_DEP_KEYS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const;

function stripRange(spec: string): string | null {
  const cleaned = spec.trim().replace(/^[\^~>=<*xX\s]+/, '');
  const v = semver.valid(cleaned);
  return v ?? null;
}

function extractNpmDependencyMap(content: string): Map<string, string> {
  const map = new Map<string, string>();
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return map;
  }
  if (!parsed || typeof parsed !== 'object') return map;
  const obj = parsed as Record<string, unknown>;
  for (const k of NPM_DEP_KEYS) {
    const block = obj[k];
    if (!block || typeof block !== 'object') continue;
    for (const [name, spec] of Object.entries(block as Record<string, unknown>)) {
      if (typeof spec !== 'string') continue;
      const v = stripRange(spec);
      if (v) map.set(name, v);
    }
  }
  return map;
}

function bumpsFromMaps(
  beforeMap: Map<string, string>,
  afterMap: Map<string, string>,
  ecosystem: Ecosystem,
  extra: Partial<Bump> = {},
): Bump[] {
  const out: Bump[] = [];
  for (const [name, afterVer] of afterMap) {
    const beforeVer = beforeMap.get(name);
    if (!beforeVer || beforeVer === afterVer) continue;
    if (!isUpgrade(beforeVer, afterVer)) continue; // downgrades are not "bumps"
    out.push({ name, from: beforeVer, to: afterVer, ecosystem, ...extra });
  }
  return out;
}

export function detectNpmBumps(before: string, after: string): Bump[] {
  return bumpsFromMaps(extractNpmDependencyMap(before), extractNpmDependencyMap(after), 'npm', {
    direct: true,
  });
}

// ---------------------------------------------------------------------------
// npm: package-lock.json / npm-shrinkwrap.json (lockfile v1, v2, v3)
// ---------------------------------------------------------------------------

function lockVersions(content: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return out;
  }
  if (!parsed || typeof parsed !== 'object') return out;
  const add = (name: string, version: unknown): void => {
    if (!name || typeof version !== 'string' || !semver.valid(version)) return;
    const set = out.get(name) ?? new Set<string>();
    set.add(version);
    out.set(name, set);
  };
  const obj = parsed as Record<string, unknown>;
  const packages = obj.packages;
  if (packages && typeof packages === 'object') {
    // v2/v3: keys are install paths, e.g. "node_modules/a/node_modules/@s/b".
    for (const [path, meta] of Object.entries(packages as Record<string, unknown>)) {
      if (!path) continue; // root project
      const idx = path.lastIndexOf('node_modules/');
      if (idx === -1) continue; // workspace folder, not an installed package
      const name = path.slice(idx + 'node_modules/'.length);
      const m = meta as Record<string, unknown> | null;
      if (m && m.link === true) continue;
      add(name, m?.version);
    }
    return out;
  }
  // v1: nested "dependencies" tree.
  const walk = (deps: unknown): void => {
    if (!deps || typeof deps !== 'object') return;
    for (const [name, meta] of Object.entries(deps as Record<string, unknown>)) {
      const m = meta as Record<string, unknown> | null;
      add(name, m?.version);
      walk(m?.dependencies);
    }
  };
  walk(obj.dependencies);
  return out;
}

function directNames(content: string): Set<string> {
  // The root entry of a v2/v3 lockfile lists the direct dependencies.
  try {
    const obj = JSON.parse(content) as Record<string, unknown>;
    const root = (obj.packages as Record<string, Record<string, unknown>> | undefined)?.[''];
    const names = new Set<string>();
    for (const k of NPM_DEP_KEYS) {
      const block = root?.[k];
      if (block && typeof block === 'object') for (const n of Object.keys(block)) names.add(n);
    }
    return names;
  } catch {
    return new Set();
  }
}

export function detectNpmLockBumps(before: string, after: string): Bump[] {
  const a = lockVersions(before);
  const b = lockVersions(after);
  const direct = directNames(after);
  const out: Bump[] = [];
  for (const [name, afterSet] of b) {
    const beforeSet = a.get(name);
    if (!beforeSet) continue; // newly added package
    const removed = [...beforeSet].filter((v) => !afterSet.has(v)).sort(cmpDesc);
    const added = [...afterSet].filter((v) => !beforeSet.has(v)).sort(cmpDesc);
    const from = removed[0];
    const to = added[0];
    if (!from || !to || !isUpgrade(from, to)) continue;
    out.push({ name, from, to, ecosystem: 'npm', direct: direct.has(name) });
  }
  return out;
}

function cmpDesc(x: string, y: string): number {
  return semver.gt(x, y) ? -1 : semver.lt(x, y) ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Python: requirements*.txt, poetry.lock, uv.lock
// ---------------------------------------------------------------------------

function requirementsMap(content: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '').replace(/^#.*$/, '').trim();
    if (!line || line.startsWith('-')) continue;
    // name[extras]==version ; markers
    const m = line.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]*\])?\s*===?\s*([^\s;,\\]+)/);
    if (!m || !m[1] || !m[2]) continue;
    map.set(normalizePyName(m[1]), m[2]);
  }
  return map;
}

function tomlLockMap(content: string): Map<string, string> {
  // poetry.lock and uv.lock both use [[package]] tables with name/version.
  const map = new Map<string, string>();
  for (const block of content.split(/^\[\[package\]\]\s*$/m).slice(1)) {
    const name = block.match(/^name\s*=\s*"([^"]+)"/m)?.[1];
    const version = block.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
    if (name && version) map.set(normalizePyName(name), version);
  }
  return map;
}

export function detectPipBumps(filename: string, before: string, after: string): Bump[] {
  const base = filename.split('/').pop() ?? filename;
  const parse = base.endsWith('.lock') ? tomlLockMap : requirementsMap;
  return bumpsFromMaps(parse(before), parse(after), 'pip', {
    direct: !base.endsWith('.lock') ? true : undefined,
  });
}

// ---------------------------------------------------------------------------
// Go: go.mod
// ---------------------------------------------------------------------------

function goModMap(content: string): Map<string, { version: string; indirect: boolean }> {
  const map = new Map<string, { version: string; indirect: boolean }>();
  let inRequire = false;
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^require\s*\($/.test(line)) {
      inRequire = true;
      continue;
    }
    if (inRequire && line === ')') {
      inRequire = false;
      continue;
    }
    const body = inRequire ? line : line.match(/^require\s+(.+)$/)?.[1];
    if (!body) continue;
    const m = body.match(/^(\S+)\s+(v\S+)(.*)$/);
    if (!m || !m[1] || !m[2]) continue;
    map.set(m[1], { version: m[2], indirect: /\/\/\s*indirect/.test(m[3] ?? '') });
  }
  return map;
}

export function detectGoBumps(before: string, after: string): Bump[] {
  const a = goModMap(before);
  const b = goModMap(after);
  const out: Bump[] = [];
  for (const [name, now] of b) {
    const prev = a.get(name);
    if (!prev || prev.version === now.version) continue;
    if (!isUpgrade(prev.version, now.version)) continue;
    out.push({ name, from: prev.version, to: now.version, ecosystem: 'go', direct: !now.indirect });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

export type ManifestKind = 'npm-manifest' | 'npm-lock' | 'pip' | 'go';

export function manifestKindForPath(filename: string): ManifestKind | null {
  const base = filename.split('/').pop() ?? filename;
  if (base === 'package.json') return 'npm-manifest';
  if (base === 'package-lock.json' || base === 'npm-shrinkwrap.json') return 'npm-lock';
  if (/^requirements.*\.txt$/.test(base) || base === 'poetry.lock' || base === 'uv.lock') return 'pip';
  if (base === 'go.mod') return 'go';
  return null;
}

export function ecosystemForPath(filename: string): Ecosystem | null {
  const kind = manifestKindForPath(filename);
  if (kind === 'npm-manifest' || kind === 'npm-lock') return 'npm';
  if (kind === 'pip') return 'pip';
  if (kind === 'go') return 'go';
  return null;
}

export function detectBumps(filename: string, before: string, after: string): Bump[] {
  const kind = manifestKindForPath(filename);
  const tag = (bumps: Bump[]): Bump[] => bumps.map((b) => ({ ...b, file: filename }));
  switch (kind) {
    case 'npm-manifest':
      return tag(detectNpmBumps(before, after));
    case 'npm-lock':
      return tag(detectNpmLockBumps(before, after));
    case 'pip':
      return tag(detectPipBumps(filename, before, after));
    case 'go':
      return tag(detectGoBumps(before, after));
    default:
      return [];
  }
}

/**
 * Merge bumps from several files. When package.json and package-lock.json
 * both report the same package, keep the lockfile's (exact installed) versions
 * but remember it is a direct dependency.
 */
export function mergeBumps(bumps: Bump[]): Bump[] {
  const byKey = new Map<string, Bump>();
  const order: string[] = [];
  for (const b of bumps) {
    const key = `${b.ecosystem}::${b.name}`;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, b);
      order.push(key);
      continue;
    }
    const prevIsLock = manifestKindForPath(prev.file ?? '') === 'npm-lock';
    const curIsLock = manifestKindForPath(b.file ?? '') === 'npm-lock';
    const keep = curIsLock && !prevIsLock ? b : prev;
    byKey.set(key, { ...keep, direct: Boolean(prev.direct || b.direct) || keep.direct });
  }
  return order.map((k) => byKey.get(k)).filter((b): b is Bump => !!b);
}

export const DETECTORS = ['npm', 'pip', 'go'] as const satisfies readonly Ecosystem[];
