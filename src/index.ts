import * as core from '@actions/core';
import * as github from '@actions/github';
import { lookupBreakingChanges } from './changelog-lookup';
import { renderComment } from './comment';
import { lookupAdvisories } from './cve-lookup';
import { detectNpmBumps, ecosystemForPath } from './ecosystems';
import { readInputs } from './inputs';
import { appendPrWarnings } from './pr-description';
import { COMMENT_MARKER, findExistingComment } from './state';
import type { Bump, BumpResult, Inputs } from './types';

interface PrContext {
  owner: string;
  repo: string;
  prNumber: number;
  headSha: string;
  baseSha: string;
}

function getPrContext(): PrContext | null {
  const ctx = github.context;
  const pr = ctx.payload.pull_request;
  if (!pr) return null;
  const { owner, repo } = ctx.repo;
  if (!owner || !repo) return null;
  const prNumber = pr.number;
  const headSha = pr.head?.sha ?? '';
  const baseSha = pr.base?.sha ?? '';
  if (!prNumber || !headSha || !baseSha) return null;
  return { owner, repo, prNumber, headSha, baseSha };
}

interface DiffFile {
  filename: string;
  status: string;
}

async function listChangedFiles(
  octokit: ReturnType<typeof github.getOctokit>,
  ctx: PrContext,
): Promise<DiffFile[]> {
  const out: DiffFile[] = [];
  let page = 1;
  while (true) {
    const res = await octokit.rest.pulls.listFiles({
      owner: ctx.owner,
      repo: ctx.repo,
      pull_number: ctx.prNumber,
      per_page: 100,
      page,
    });
    const files = res.data ?? [];
    if (files.length === 0) break;
    for (const f of files) {
      out.push({ filename: f.filename, status: f.status });
    }
    if (files.length < 100) break;
    page += 1;
    if (page > 5) break;
  }
  return out;
}

async function fetchFileAt(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  path: string,
  ref: string,
): Promise<string> {
  try {
    const res = await octokit.rest.repos.getContent({
      owner,
      repo,
      path,
      ref,
    });
    const data = res.data as unknown;
    if (Array.isArray(data)) return '';
    if (!data || typeof data !== 'object') return '';
    const blob = (data as Record<string, unknown>).content;
    if (typeof blob === 'string') {
      const trimmed = blob.replace(/\n/g, '');
      return Buffer.from(trimmed, 'base64').toString('utf8');
    }
    return '';
  } catch {
    return '';
  }
}

async function collectNpmBumps(
  files: DiffFile[],
  octokit: ReturnType<typeof github.getOctokit>,
  ctx: PrContext,
): Promise<Bump[]> {
  const out: Bump[] = [];
  for (const f of files) {
    if (ecosystemForPath(f.filename) !== 'npm') continue;
    let before = '';
    let after = '';
    if (f.status === 'added') {
      after = await fetchFileAt(octokit, ctx.owner, ctx.repo, f.filename, ctx.headSha);
    } else if (f.status === 'removed') {
      before = await fetchFileAt(octokit, ctx.owner, ctx.repo, f.filename, ctx.baseSha);
    } else {
      after = await fetchFileAt(octokit, ctx.owner, ctx.repo, f.filename, ctx.headSha);
      before = await fetchFileAt(octokit, ctx.owner, ctx.repo, f.filename, ctx.baseSha);
    }
    for (const b of detectNpmBumps(before, after)) out.push(b);
  }
  return out;
}

async function postComment(
  octokit: ReturnType<typeof github.getOctokit>,
  inputs: Inputs,
  ctx: PrContext,
  body: string,
): Promise<number> {
  const marker = inputs.commentMarker || COMMENT_MARKER;
  const existing = await findExistingComment(octokit, ctx.owner, ctx.repo, ctx.prNumber, marker);
  if (existing) {
    const res = await octokit.rest.issues.updateComment({
      owner: ctx.owner,
      repo: ctx.repo,
      comment_id: existing.id,
      body,
    });
    return res.data.id;
  }
  const res = await octokit.rest.issues.createComment({
    owner: ctx.owner,
    repo: ctx.repo,
    issue_number: ctx.prNumber,
    body,
  });
  return res.data.id;
}

export async function process(
  prCtx: PrContext,
  octokit: ReturnType<typeof github.getOctokit>,
  inputs: Inputs,
): Promise<{
  body: string;
  results: BumpResult[];
  commentId: number;
  prDescriptionUpdated: boolean;
  prWarningCount: number;
}> {
  const files = await listChangedFiles(octokit, prCtx);
  const bumps = await collectNpmBumps(files, octokit, prCtx);

  const results: BumpResult[] = await Promise.all(
    bumps.map(async (bump) => {
      const [advisories, breakingChanges] = await Promise.all([
        lookupAdvisories(bump, octokit as unknown as Parameters<typeof lookupAdvisories>[1]),
        lookupBreakingChanges(bump, octokit),
      ]);
      return {
        bump,
        cves: advisories.cves,
        fixes: advisories.fixes,
        advisoryLookupFailed: advisories.failed,
        breakingChanges,
      };
    }),
  );

  const body = renderComment(results);
  const commentId = await postComment(octokit, inputs, prCtx, body);
  const { updated, warningCount } = await appendPrWarnings(
    octokit,
    { owner: prCtx.owner, repo: prCtx.repo, prNumber: prCtx.prNumber },
    results,
  );
  return { body, results, commentId, prDescriptionUpdated: updated, prWarningCount: warningCount };
}

export async function run(): Promise<void> {
  try {
    const inputs = readInputs();
    const ctx = getPrContext();
    if (!ctx) {
      core.warning('No pull_request context — bivouac-action only runs on pull_request events.');
      core.setOutput('cve-summary', '[]');
      core.setOutput('breaking-summary', '[]');
      core.setOutput('breaking-change-summary', '[]');
      core.setOutput('comment-id', '0');
      core.setOutput('pr-warning-count', '0');
      core.setOutput('pr-description-updated', 'false');
      return;
    }
    const octokit = github.getOctokit(inputs.githubToken);
    const { results, commentId, prDescriptionUpdated, prWarningCount } = await process(
      ctx,
      octokit,
      inputs,
    );

    // cve-summary: per-bump entry combining CVEs + the legacy
    // `{version, source, url, markers}` shaped breaking-change rows — kept
    // stable for the existing downstream workflow.
    core.setOutput(
      'cve-summary',
      JSON.stringify(
        results.map((r) => ({
          name: r.bump.name,
          from: r.bump.from,
          to: r.bump.to,
          cves: r.cves.map((c) => c.id),
          breakingChanges: r.breakingChanges.map((bc) => ({
            version: bc.version,
            source: bc.source,
            url: bc.url,
            markers: bc.markers,
          })),
        })),
      ),
    );

    // breaking-summary: the legacy "bump-level row" used by the README table.
    const breakingBumps = results
      .filter((r) => r.breakingChanges.length > 0)
      .map((r) => ({
        name: r.bump.name,
        from: r.bump.from,
        to: r.bump.to,
        breakingChanges: r.breakingChanges,
      }));

    core.setOutput('breaking-summary', JSON.stringify(breakingBumps));

    // breaking-change-summary (new, optional): per-bump entry with the full
    // structured BreakingChangeFinding — including category, summary,
    // migrationNote. Workflows that want to react to the typed shape read this
    // instead of `breaking-summary`.
    core.setOutput(
      'breaking-change-summary',
      JSON.stringify(
        results
          .filter((r) => r.breakingChanges.length > 0)
          .map((r) => ({
            name: r.bump.name,
            from: r.bump.from,
            to: r.bump.to,
            findings: r.breakingChanges,
          })),
      ),
    );

    core.setOutput('comment-id', String(commentId));
    core.setOutput('pr-warning-count', String(prWarningCount));
    core.setOutput('pr-description-updated', String(prDescriptionUpdated));
  } catch (err) {
    if (err instanceof Error) {
      core.setFailed(`bivouac-action failed: ${err.message}`);
    } else {
      core.setFailed('bivouac-action failed.');
    }
  }
}

export { COMMENT_MARKER };
