// local ambient declarations so the Action's source files
// typecheck cleanly under the Next.js app's root tsconfig (which the build gate
// runs `tsc --noEmit` against). The Action bundles its REAL deps (resolved at
// npm install time inside action/) through @vercel/ncc — these shims are
// compile-time only and never reach the runtime bundle.

declare module '@actions/core' {
  export function getInput(name: string, options?: { required?: boolean }): string;
  export function setOutput(name: string, value: string): void;
  export function info(message: string): void;
  export function warning(message: string): void;
  export function setFailed(message: string): void;
  export function debug(message: string): void;
  export function error(message: string): void;
}

interface OctokitResponse<T> {
  data: T;
}

interface OctokitRestIssues {
  listComments: (params: {
    owner: string;
    repo: string;
    issue_number: number;
    per_page?: number;
  }) => Promise<OctokitResponse<Array<{ id: number; body?: string | null }>>>;
  createComment: (params: {
    owner: string;
    repo: string;
    issue_number: number;
    body: string;
  }) => Promise<OctokitResponse<{ id: number }>>;
  updateComment: (params: {
    owner: string;
    repo: string;
    comment_id: number;
    body: string;
  }) => Promise<OctokitResponse<{ id: number }>>;
}

interface OctokitRestPullsListFile {
  filename: string;
  status: string;
}

interface OctokitRestPulls {
  listFiles: (params: {
    owner: string;
    repo: string;
    pull_number: number;
    per_page?: number;
    page?: number;
  }) => Promise<OctokitResponse<OctokitRestPullsListFile[]>>;
  get: (params: {
    owner: string;
    repo: string;
    pull_number: number;
  }) => Promise<OctokitResponse<{ body?: string | null }>>;
  update: (params: {
    owner: string;
    repo: string;
    pull_number: number;
    body: string;
  }) => Promise<OctokitResponse<unknown>>;
}

interface OctokitRestRepos {
  getContent: (params: {
    owner: string;
    repo: string;
    path: string;
    ref: string;
  }) => Promise<OctokitResponse<{ content?: string }>>;
}

interface OctokitRestLike {
  issues: OctokitRestIssues;
  pulls: OctokitRestPulls;
  repos: OctokitRestRepos;
}

interface OctokitLike {
  rest: OctokitRestLike;
  request: (route: string) => Promise<{ data: unknown }>;
}

interface GitHubRepo {
  owner: string;
  repo: string;
}

interface GitHubContextPayloadPullRequest {
  number: number;
  head?: { sha?: string };
  base?: { sha?: string };
  user?: { login?: string | null };
}

interface GitHubContextPayload {
  pull_request?: GitHubContextPayloadPullRequest;
}

interface GitHubContextLike {
  payload: GitHubContextPayload;
  repo: GitHubRepo;
}

declare module '@actions/github' {
  export interface GitHub {
    context: GitHubContextLike;
  }
  export const context: GitHubContextLike;
  export function getOctokit(token: string): OctokitLike;
}

declare module 'semver' {
  interface SemverValid {
    raw: string;
  }
  interface SemverRangeSet {
    operator: string;
  }
  interface SemverValidRange extends SemverValid {
    set?: Array<Array<SemverRangeSet>>;
  }
  interface SemverParsed {
    major: number;
    minor: number;
    patch: number;
    prerelease?: ReadonlyArray<string | number>;
  }
  const semver: {
    valid(input: string): string | null;
    validRange(input: string): SemverValidRange | null;
    parse(input: string): SemverParsed | null;
    gt(a: string, b: string): boolean;
    lt(a: string, b: string): boolean;
    eq(a: string, b: string): boolean;
    satisfies(version: string, range: string, options?: { includePrerelease?: boolean }): boolean;
  };
  export default semver;
}
