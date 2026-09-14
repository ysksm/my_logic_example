/** 表示用の内容別カテゴリ（CWE から対応させる）。 */
export interface Category {
  id: string;
  label: string;
  cwes: string[];
  priority: number;
}

export interface Taxonomy {
  taxonomy_version: string;
  note?: string;
  categories: Category[];
  known_other_cwes?: string[];
}

export interface RegistryPackage {
  name: string;
  repository: string;
  bugs_url?: string;
  since: string;
  until: string | null;
  bug_labels?: string[];
  confirmed_labels?: string[];
  duplicate_labels?: string[];
  invalid_labels?: string[];
  monorepo_paths?: string[];
}

export interface Registry {
  registry_version: string;
  note?: string;
  defaults: {
    bug_labels: string[];
    confirmed_labels: string[];
    duplicate_labels: string[];
    invalid_labels: string[];
  };
  packages: RegistryPackage[];
}

export type Severity = 'critical' | 'high' | 'moderate' | 'low' | 'unknown';
export const SEVERITIES: Severity[] = ['critical', 'high', 'moderate', 'low', 'unknown'];

/** 正規化済みの advisory。重複解決後の 1 件。 */
export interface NormalizedAdvisory {
  ghsa_id: string;
  cve_id: string | null;
  summary: string;
  severity: Severity;
  cvss_score: number | null;
  review_state: 'reviewed' | 'unreviewed' | 'malware';
  published_at: string | null;
  modified_at: string | null;
  withdrawn_at: string | null;
  origin: 'github' | 'osv' | 'manual';
  html_url: string | null;
  aliases: string[];
  cwes: string[];
  packages: {
    package_name: string;
    ecosystem: string;
    vulnerable_range: string | null;
    patched_version: string | null;
  }[];
}

export type BugState = 'reported' | 'confirmed' | 'duplicate' | 'invalid';

export interface NormalizedIssue {
  repository: string;
  number: number;
  package_name: string;
  title: string;
  state: 'open' | 'closed';
  state_reason: string | null;
  is_pull_request: boolean;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  labels: string[];
  html_url: string | null;
}

export type CoverageStatus = 'collected' | 'missing' | 'partial';
