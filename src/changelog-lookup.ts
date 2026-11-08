import semver from 'semver';
import type {
  BreakingChangeCategory,
  BreakingChangeFinding,
  BreakingChangeSource,
  Bump,
} from './types';

const BREAKING_MARKERS: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  { name: 'BREAKING', pattern: /\bBREAKING(?:\s+(?:CHANGE|CHANGES))?\b/i },
  { name: 'major:', pattern: /\bmajor\s*:/i },
  { name: 'removed', pattern: /\bremoved\b/i },
  { name: 'deprecated', pattern: /\bdeprecated\s+API(?:s)?\b/i },
];

interface RegistryPackage {
  versions?: Record<string, unknown>;
  time?: Record<string, string>;
  repository?: { url?: string };
  homepage?: string;
}

interface GitHubRelease {
  tag_name: string;
  body?: string;
  html_url: string;
}

interface RepoRef {
  owner: string;
  repo: string;
}

const SNIPPET_LIMIT = 240;

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function classifyCategory(markers: string[]): BreakingChangeCategory {
  if (markers.includes('removed')) return 'removed';
  if (markers.includes('deprecated')) return 'deprecated';
  if (markers.includes('BREAKING') || markers.includes('major:')) return 'behavior';
  return 'behavior';
}

function migrationNoteFor(category: BreakingChangeCategory, body: string): string {
  const wantPattern = patternFor(category);
  if (wantPattern) {
    const first = body
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => wantPattern.test(l));
    if (first) return truncate(first, 200);
  }
  return 'Review the upstream release for migration notes.';
}

function patternFor(category: BreakingChangeCategory): RegExp | null {
  switch (category) {
    case 'removed':
      return /\bmigration\b|\breplacement\b|\buse\s+/i;
    case 'renamed':
      return /\brenamed?\b|\brename\b|\buse\s+|\breplace\b/i;
    case 'deprecated':
      return /\bdeprecated\b|\buse\s+/i;
    case 'behavior':
      return null;
  }
}

function scanMarkers(body: string): {
  markers: string[];
  summary: string;
  category: BreakingChangeCategory;
  migrationNote: string;
} {
  const lines = body.split(/\r?\n/);
  const matched = new Set<string>();
  let picked = '';
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    for (const { name, pattern } of BREAKING_MARKERS) {
      if (pattern.test(line)) {
        matched.add(name);
        if (!picked) picked = line.trim();
      }
    }
  }
  if (!picked) {
    for (const { name, pattern } of BREAKING_MARKERS) {
      if (pattern.test(body)) {
        matched.add(name);
        picked = body.replace(/\s+/g, ' ').trim();
        break;
      }
    }
  }
  const markers = [...matched];
  const category = classifyCategory(markers);
  return {
    markers,
    summary: truncate(picked, SNIPPET_LIMIT),
    category,
    migrationNote: migrationNoteFor(category, body),
  };
}

function parseRepo(value: string | undefined): RepoRef | null {
  if (!value) return null;
  // Accept any of:
  //   https://github.com/lodash/lodash
  //   git+https://github.com/lodash/lodash.git
  //   git://github.com/lodash/lodash.git
  //   github:lodash/lodash
  const m = value.match(/github\.com[/:]+([^/\s]+)\/([^/\s]+?)(?:\.git)?(?:\/.*)?$/i);
  if (!m) return null;
  const owner = m[1];
  const repo = m[2];
  if (!owner || !repo) return null;
  return { owner, repo };
}

async function fetchRegistry(name: string): Promise<RegistryPackage | null> {
  try {
    const res = await globalThis.fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`);
    if (!res.ok) return null;
    const data = (await res.json()) as RegistryPackage;
    return data;
  } catch {
    return null;
  }
}

function versionsInRange(from: string, to: string, known: ReadonlyArray<string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of known) {
    if (!semver.valid(v)) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    if (semver.lt(v, from)) continue;
    if (semver.gt(v, to)) continue;
    out.push(v);
  }
  return out;
}

interface FetchContentOctokit {
  request: (route: string, params?: unknown) => Promise<{ data: unknown }>;
  rest?: {
    repos?: {
      getContent: (p: {
        owner: string;
        repo: string;
        path: string;
        ref: string;
      }) => Promise<{ data: unknown }>;
    };
  };
}

export async function lookupBreakingChanges(
  bump: Bump,
  octokit: FetchContentOctokit,
): Promise<BreakingChangeFinding[]> {
  const fromV = semver.valid(bump.from);
  const toV = semver.valid(bump.to);
  if (!fromV || !toV) return [];

  const registry = await fetchRegistry(bump.name);
  const known = Object.keys(registry?.time ?? {});
  const candidateVersions = versionsInRange(fromV, toV, known);
  const repo = parseRepo(registry?.repository?.url) ?? parseRepo(registry?.homepage);

  const out: BreakingChangeFinding[] = [];

  let releases: GitHubRelease[] | null = null;
  if (repo) {
    releases = await fetchGitHubReleases(octokit, repo.owner, repo.repo);
    if (releases) {
      for (const v of candidateVersions) {
        const release = findMatchingRelease(releases, v);
        if (!release) continue;
        const body = release.body ?? '';
        if (body.length === 0) continue;
        const { markers, summary, category, migrationNote } = scanMarkers(body);
        if (markers.length === 0) continue;
        out.push({
          version: v,
          source: 'github-releases',
          category,
          summary,
          migrationNote,
          url: release.html_url,
          markers,
        });
      }

      const md = await fetchChangelogMd(octokit, repo, pickRef(candidateVersions, toV));
      if (md) {
        for (const v of candidateVersions) {
          for (const f of scanChangelogFinding(md, v, repo)) {
            out.push(f);
          }
        }
      }
    }
  }

  // Always emit a major-version boundary finding when the bump crosses a
  // major. This guarantees the diff-review signal even when neither release
  // notes nor CHANGELOG.md carry markers.
  const toMajor = semver.parse(toV)?.major;
  const fromMajor = semver.parse(fromV)?.major;
  if (toMajor !== undefined && fromMajor !== undefined && toMajor !== fromMajor) {
    const url = repo ? `https://github.com/${repo.owner}/${repo.repo}/releases/tag/v${toV}` : '';
    out.push({
      version: toV,
      source: 'major-version-diff',
      category: 'behavior',
      summary: 'Major-version boundary',
      migrationNote: 'Read upstream major-version diff for migration notes.',
      url,
      markers: ['major'],
    });
  }

  return dedupeFindings(out);
}

function dedupeFindings(findings: BreakingChangeFinding[]): BreakingChangeFinding[] {
  const seen = new Set<string>();
  const out: BreakingChangeFinding[] = [];
  for (const f of findings) {
    const key = `${f.version}::${f.source}::${f.category}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

function pickRef(candidateVersions: string[], toV: string): string {
  for (let i = candidateVersions.length - 1; i >= 0; i -= 1) {
    const v = candidateVersions[i];
    if (v && semver.valid(v)) return v;
  }
  return toV;
}

async function fetchGitHubReleases(
  octokit: { request: (route: string) => Promise<{ data: unknown }> },
  owner: string,
  repo: string,
): Promise<GitHubRelease[] | null> {
  try {
    const res = await octokit.request(`GET /repos/${owner}/${repo}/releases`);
    const data = (res.data ?? []) as unknown;
    if (!Array.isArray(data)) return null;
    return data as GitHubRelease[];
  } catch {
    return null;
  }
}

async function fetchChangelogMd(
  octokit: FetchContentOctokit,
  repo: RepoRef,
  ref: string,
): Promise<string | null> {
  try {
    const getContent = octokit.rest?.repos?.getContent;
    if (!getContent) return null;
    const res = await getContent({
      owner: repo.owner,
      repo: repo.repo,
      path: 'CHANGELOG.md',
      ref,
    });
    const data = res.data as unknown;
    if (Array.isArray(data)) return null;
    if (!data || typeof data !== 'object') return null;
    const blob = (data as Record<string, unknown>).content;
    if (typeof blob !== 'string') return null;
    const trimmed = blob.replace(/\n/g, '');
    return Buffer.from(trimmed, 'base64').toString('utf8');
  } catch {
    return null;
  }
}

const CHANGELOG_SECTION_RE = /^#{1,4}\s+\[?v?(\d+\.\d+\.\d+(?:-[\w.]+)?)\]?/;

function scanChangelogFinding(
  body: string,
  version: string,
  repo: RepoRef,
): BreakingChangeFinding[] {
  const lines = body.split(/\r?\n/);
  let sectionStart = -1;
  let sectionEnd = lines.length;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    const m = line.match(CHANGELOG_SECTION_RE);
    if (!m) continue;
    if (m[1] === version) {
      sectionStart = i;
    } else if (sectionStart !== -1) {
      sectionEnd = i;
      break;
    }
  }
  if (sectionStart === -1) return [];

  const sectionBody = lines.slice(sectionStart + 1, sectionEnd).join('\n');
  const { markers, summary, category, migrationNote } = scanMarkers(sectionBody);
  if (markers.length === 0) return [];
  const url = `https://github.com/${repo.owner}/${repo.repo}/blob/HEAD/CHANGELOG.md#v${version}`;
  return [
    {
      version,
      source: 'changelog-md' as BreakingChangeSource,
      category,
      summary,
      migrationNote,
      url,
      markers,
    },
  ];
}

function stripTagPrefix(tag: string): string {
  const idx = tag.lastIndexOf('v');
  if (idx <= 0) return tag;
  const suffix = tag.slice(idx + 1);
  if (semver.valid(suffix)) return suffix;
  return tag;
}

function findMatchingRelease(releases: GitHubRelease[], version: string): GitHubRelease | null {
  for (const r of releases) {
    if (!r.tag_name) continue;
    const normalized = stripTagPrefix(r.tag_name);
    if (!semver.valid(normalized)) continue;
    if (semver.eq(normalized, version)) return r;
  }
  return null;
}
