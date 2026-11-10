export type Ecosystem = 'npm';

export interface Bump {
  name: string;
  from: string;
  to: string;
  ecosystem: Ecosystem;
}

export interface VulnerabilityRef {
  id: string;
  summary: string;
  severity: string;
  aliases: string[];
  fixedVersions: string[];
  url?: string;
}

export type BreakingChangeSource =
  | 'npm-registry'
  | 'github-releases'
  | 'changelog-md'
  | 'major-version-diff';

export type BreakingChangeCategory = 'removed' | 'renamed' | 'behavior' | 'deprecated';

export interface BreakingChangeFinding {
  version: string;
  source: BreakingChangeSource;
  category: BreakingChangeCategory;
  summary: string;
  migrationNote: string;
  url: string;
  markers: string[];
}

// Kept for backward compatibility with existing readers (e.g. consumers of the
// `breaking-summary` output). New findings are emitted as `BreakingChangeFinding`
// entries; older code paths still produce `BreakingChangeRef` items, and the
// index.ts reducer normalises both into the legacy shape.
export interface BreakingChangeRef {
  version: string;
  source: BreakingChangeSource;
  url: string;
  markers: string[];
  snippet: string;
  category?: BreakingChangeCategory;
  migrationNote?: string;
}

export interface BumpResult {
  bump: Bump;
  /** Advisories that still affect the new version. */
  cves: VulnerabilityRef[];
  /** Advisories that affected the old version and are fixed by this bump. */
  fixes?: VulnerabilityRef[];
  /** True when the advisory database could not be reached for this bump. */
  advisoryLookupFailed?: boolean;
  breakingChanges: BreakingChangeFinding[];
}

export interface Inputs {
  githubToken: string;
  commentMarker: string;
}
