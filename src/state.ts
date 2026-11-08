export const COMMENT_MARKER = '<!-- bivouac-action -->';

export function markerFor(input: string): string {
  const trimmed = input.trim();
  if (trimmed.length === 0) return COMMENT_MARKER;
  return trimmed;
}

interface CommentLike {
  id: number;
  body?: string | null;
}

export async function findExistingComment(
  octokit: {
    rest: {
      issues: {
        listComments: (params: {
          owner: string;
          repo: string;
          issue_number: number;
          per_page?: number;
        }) => Promise<{ data: CommentLike[] }>;
      };
    };
  },
  owner: string,
  repo: string,
  prNumber: number,
  marker: string = COMMENT_MARKER,
): Promise<{ id: number; body: string } | null> {
  const result = await octokit.rest.issues.listComments({
    owner,
    repo,
    issue_number: prNumber,
    per_page: 100,
  });
  const data = result.data ?? [];
  // Walk newest-first; preserve the convention that "the most recent bivouac
  // comment" wins — older duplicates are treated as stale.
  for (let i = data.length - 1; i >= 0; i -= 1) {
    const c = data[i];
    if (!c || typeof c.body !== 'string') continue;
    if (!c.body.includes(marker)) continue;
    return { id: c.id, body: c.body };
  }
  return null;
}
