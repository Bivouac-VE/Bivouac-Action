import { COMMENT_MARKER } from './state';
import type {
  BreakingChangeCategory,
  BreakingChangeFinding,
  BumpResult,
  VulnerabilityRef,
} from './types';

function renderCveTable(cves: VulnerabilityRef[]): string {
  if (cves.length === 0) return '_No CVEs match the new version._';
  const lines: string[] = [];
  lines.push('| ID | Severity | Aliases | Summary |');
  lines.push('| --- | --- | --- | --- |');
  for (const c of cves) {
    const summary = c.summary.length > 120 ? `${c.summary.slice(0, 117)}…` : c.summary;
    const aliases = c.aliases.length > 0 ? c.aliases.map((a) => `\`${a}\``).join(', ') : '—';
    lines.push(`| \`${c.id}\` | ${c.severity} | ${aliases} | ${summary} |`);
  }
  return lines.join('\n');
}

function categoryTag(category: BreakingChangeCategory): string {
  switch (category) {
    case 'removed':
      return '[removed]';
    case 'renamed':
      return '[renamed]';
    case 'behavior':
      return '[breaking]';
    case 'deprecated':
      return '[deprecated]';
  }
}

function renderBreakingChanges(findings: BreakingChangeFinding[]): string {
  // Bucket findings by source so each upstream signal gets its own stanza with
  // a descriptive header. Order: release-notes, CHANGELOG.md, major-version-diff.
  const order: Array<'github-releases' | 'changelog-md' | 'major-version-diff'> = [
    'github-releases',
    'changelog-md',
    'major-version-diff',
  ];
  const headers: Record<(typeof order)[number], string> = {
    'github-releases': 'Release notes',
    'changelog-md': 'CHANGELOG.md',
    'major-version-diff': 'Major-version diff',
  };

  const lines: string[] = [];
  const totalFindings = findings.length;
  if (totalFindings > 0) {
    lines.push(`**Breaking changes** (${totalFindings} finding(s) flagged):`);
    lines.push('');
  }

  for (const source of order) {
    const group = findings.filter((f) => f.source === source);
    if (group.length === 0) continue;
    lines.push(`**Breaking changes** (${headers[source]}):`);
    lines.push('');
    for (const f of group) {
      const tag = categoryTag(f.category);
      const summary = f.summary.length > 0 ? f.summary : `_marker: ${f.markers.join(', ')}_`;
      lines.push(`> ${tag} \`${f.version}\` — "${summary}" — [link](${f.url})`);
      lines.push(`> _Migration:_ **${f.migrationNote}**`);
      if (f.markers.length > 0) {
        lines.push(`> _Detected markers: ${f.markers.join(', ')}._`);
      }
    }
  }
  return lines.join('\n');
}

function summaryLine(results: BumpResult[]): string {
  let withCves = 0;
  let withBreaking = 0;
  let totalFindings = 0;
  for (const r of results) {
    if (r.cves.length > 0) withCves += 1;
    if (r.breakingChanges.length > 0) withBreaking += 1;
    totalFindings += r.breakingChanges.length;
  }
  const total = results.length;
  const noun = total === 1 ? 'bump' : 'bumps';
  const findingNoun = totalFindings === 1 ? 'finding' : 'findings';
  return `**${total} ${noun} analysed · ${withCves} match known advisories · ${withBreaking} flag breaking changes · ${totalFindings} ${findingNoun}.**`;
}

function renderBumpSection(result: BumpResult): string {
  const { bump, cves, breakingChanges } = result;
  const lines: string[] = [];
  lines.push(`### \`${bump.name}\` \`${bump.from}\` → \`${bump.to}\``);
  lines.push('');
  lines.push(renderCveTable(cves));
  if (breakingChanges.length > 0) {
    lines.push('');
    lines.push(renderBreakingChanges(breakingChanges));
    lines.push('');
    lines.push('_Full quoted snippets are mirrored to the PR description by bivouac-action._');
  }
  return lines.join('\n');
}

export function renderComment(results: BumpResult[]): string {
  const lines: string[] = [];
  lines.push(COMMENT_MARKER);
  lines.push('## Dependency bump CVE summary');
  lines.push('');
  if (results.length === 0) {
    lines.push('_No dependency bumps detected in the PR._');
    lines.push('');
    return lines.join('\n');
  }
  lines.push(summaryLine(results));
  lines.push('');
  for (const r of results) {
    lines.push(renderBumpSection(r));
    lines.push('');
  }
  return lines.join('\n');
}
