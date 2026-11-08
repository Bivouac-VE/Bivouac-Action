import * as core from '@actions/core';
import type { BreakingChangeFinding, BumpResult } from './types';

const START_MARKER = '<!-- bivouac-action:pr-warnings:start -->';
const END_MARKER = '<!-- bivouac-action:pr-warnings:end -->';

interface PullsGet {
  (params: {
    owner: string;
    repo: string;
    pull_number: number;
  }): Promise<{
    data: { body?: string | null };
  }>;
}

interface PullsUpdate {
  (params: {
    owner: string;
    repo: string;
    pull_number: number;
    body: string;
  }): Promise<{
    data: unknown;
  }>;
}

export interface OctokitLikeForPr {
  rest: {
    pulls: {
      get: PullsGet;
      update: PullsUpdate;
    };
  };
}

export interface PrContext {
  owner: string;
  repo: string;
  prNumber: number;
}

export interface PrDescriptionResult {
  updated: boolean;
  reason?: string;
  warningCount: number;
}

type FindingRow = {
  packageName: string;
  fromVersion: string;
  toVersion: string;
  finding: BreakingChangeFinding;
};

function dedupeRows(rows: FindingRow[]): FindingRow[] {
  const seen = new Set<string>();
  const out: FindingRow[] = [];
  for (const r of rows) {
    const key = `${r.packageName}::${r.finding.source}::${r.finding.version}::${r.finding.summary}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

function categoryLabel(category: BreakingChangeFinding['category']): string {
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

function sourceLabel(source: BreakingChangeFinding['source']): string {
  switch (source) {
    case 'github-releases':
      return 'release notes';
    case 'changelog-md':
      return 'CHANGELOG.md';
    case 'major-version-diff':
      return 'major-version-diff';
    case 'npm-registry':
      return 'npm-registry';
  }
}

function escapeForHeading(name: string, from: string, to: string): string {
  return `### \`${name}\` \`${from}\` → \`${to}\``;
}

function linkTextFor(finding: BreakingChangeFinding): string {
  const label = sourceLabel(finding.source);
  return `${label} (${finding.version})`;
}

function renderFindingRow(row: FindingRow): string {
  const { finding } = row;
  const lines: string[] = [];
  const tag = categoryLabel(finding.category);
  const summary =
    finding.summary.length > 0 ? finding.summary : `marker: ${finding.markers.join(', ')}`;
  const linkText = linkTextFor(finding);
  lines.push(`> ${tag} "${summary}" — [${linkText}](${finding.url})`);
  lines.push(`> _Migration:_ **${finding.migrationNote}**`);
  const markersPart =
    finding.markers.length > 0 ? ` · _Detected markers:_ ${finding.markers.join(', ')}` : '';
  lines.push(`> _Source:_ \`${finding.source}\`${markersPart}`);
  return lines.join('\n');
}

function buildWarningBlock(rows: FindingRow[]): string {
  const byPackage = new Map<string, FindingRow[]>();
  for (const r of rows) {
    const arr = byPackage.get(r.packageName) ?? [];
    arr.push(r);
    byPackage.set(r.packageName, arr);
  }
  const packageNames = [...byPackage.keys()].sort();

  const lines: string[] = [];
  lines.push(START_MARKER);
  lines.push('## ⚠️ Breaking change warnings (bivouac-action)');
  lines.push('');
  lines.push(
    'The following bumped packages have documented breaking changes between the old and new versions on this PR. Review before merging.',
  );
  for (const pkg of packageNames) {
    const group = byPackage.get(pkg) ?? [];
    if (group.length === 0) continue;
    const first = group[0];
    if (!first) continue;
    lines.push('');
    lines.push(escapeForHeading(first.packageName, first.fromVersion, first.toVersion));
    for (const row of group) {
      lines.push('');
      lines.push(renderFindingRow(row));
    }
  }
  lines.push(END_MARKER);
  return lines.join('\n');
}

function stripExistingWarningBlock(body: string): string {
  const startIdx = body.indexOf(START_MARKER);
  if (startIdx === -1) return body;
  const endIdx = body.indexOf(END_MARKER, startIdx + START_MARKER.length);
  if (endIdx === -1) return body;
  const before = body.slice(0, startIdx);
  const after = body.slice(endIdx + END_MARKER.length);
  return `${before}${after}`;
}

function assembleNewBody(originalBody: string, warningBlock: string): string {
  const trimmed = originalBody.replace(/\s+$/u, '');
  if (trimmed.length === 0) return warningBlock;
  return `${trimmed}\n\n${warningBlock}`;
}

function collectRows(results: BumpResult[]): FindingRow[] {
  const rows: FindingRow[] = [];
  for (const r of results) {
    if (r.breakingChanges.length === 0) continue;
    for (const finding of r.breakingChanges) {
      rows.push({
        packageName: r.bump.name,
        fromVersion: r.bump.from,
        toVersion: r.bump.to,
        finding,
      });
    }
  }
  rows.sort((a, b) => {
    if (a.packageName < b.packageName) return -1;
    if (a.packageName > b.packageName) return 1;
    return 0;
  });
  return dedupeRows(rows);
}

export async function appendPrWarnings(
  octokit: OctokitLikeForPr,
  prCtx: PrContext,
  results: BumpResult[],
): Promise<PrDescriptionResult> {
  const rows = collectRows(results);
  if (rows.length === 0) {
    return { updated: false, warningCount: 0 };
  }

  try {
    const getRes = await octokit.rest.pulls.get({
      owner: prCtx.owner,
      repo: prCtx.repo,
      pull_number: prCtx.prNumber,
    });
    const originalBody = getRes.data.body ?? '';
    const stripped = stripExistingWarningBlock(originalBody);
    const warningBlock = buildWarningBlock(rows);
    const newBody = assembleNewBody(stripped, warningBlock);

    await octokit.rest.pulls.update({
      owner: prCtx.owner,
      repo: prCtx.repo,
      pull_number: prCtx.prNumber,
      body: newBody,
    });

    core.info(
      `Appended ${rows.length} breaking-change warning row(s) to PR #${prCtx.prNumber} description.`,
    );
    return { updated: true, warningCount: rows.length };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    core.warning(
      `Failed to update PR #${prCtx.prNumber} description with breaking-change warnings: ${reason}. CI run continues unaffected.`,
    );
    return { updated: false, reason, warningCount: rows.length };
  }
}
