import semver from 'semver';
import type { Bump, Ecosystem } from './types';

const NPM_DEP_KEYS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const;

function stripRange(spec: string): string | null {
  const cleaned = spec
    .trim()
    .replace(/^[\^~>=<*xX\s]+/, '')
    .replace(/[a-z]/gi, '');
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

export function detectNpmBumps(before: string, after: string): Bump[] {
  const beforeMap = extractNpmDependencyMap(before);
  const afterMap = extractNpmDependencyMap(after);
  const out: Bump[] = [];
  for (const [name, afterVer] of afterMap) {
    const beforeVer = beforeMap.get(name);
    if (!beforeVer) continue;
    if (beforeVer === afterVer) continue;
    const a = semver.valid(beforeVer);
    const b = semver.valid(afterVer);
    if (!a || !b) continue;
    if (semver.gt(a, b)) continue; // downgrades are not "bumps"
    out.push({ name, from: beforeVer, to: afterVer, ecosystem: 'npm' });
  }
  return out;
}

export function ecosystemForPath(filename: string): Ecosystem | null {
  const base = filename.split('/').pop() ?? filename;
  if (base === 'package.json') return 'npm';
  return null;
}

export const DETECTORS = ['npm'] as const satisfies readonly Ecosystem[];
