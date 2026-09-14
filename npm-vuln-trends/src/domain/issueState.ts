import type { BugState, NormalizedIssue, Registry, RegistryPackage } from './types.ts';

export interface LabelRules {
  bug: string[];
  confirmed: string[];
  duplicate: string[];
  invalid: string[];
}

export function labelRulesFor(registry: Registry, pkg: RegistryPackage): LabelRules {
  return {
    bug: pkg.bug_labels ?? registry.defaults.bug_labels,
    confirmed: pkg.confirmed_labels ?? registry.defaults.confirmed_labels,
    duplicate: pkg.duplicate_labels ?? registry.defaults.duplicate_labels,
    invalid: pkg.invalid_labels ?? registry.defaults.invalid_labels,
  };
}

/**
 * バグ判定は取得時ではなく集計時に行う。
 * 取得時に bug ラベルで絞らないため、ラベルが後から外れた場合も現在の状態が反映される。
 */
export function isBug(issue: NormalizedIssue, rules: LabelRules): boolean {
  if (issue.is_pull_request) return false;
  return matches(issue.labels, rules.bug);
}

/**
 * reported / confirmed / duplicate / invalid を区別する。
 * 投稿されただけの報告と、作者が確認した不具合を同じに数えない。
 */
export function bugState(issue: NormalizedIssue, rules: LabelRules): BugState {
  if (matches(issue.labels, rules.duplicate)) return 'duplicate';
  if (matches(issue.labels, rules.invalid)) return 'invalid';
  // not_planned でのクローズは「修正された」ではない。
  if (issue.state === 'closed' && issue.state_reason === 'not_planned') return 'invalid';
  if (matches(issue.labels, rules.confirmed)) return 'confirmed';
  return 'reported';
}

function matches(labels: string[], patterns: string[]): boolean {
  const lowered = labels.map((l) => l.toLowerCase().trim());
  return patterns.some((p) => lowered.includes(p.toLowerCase().trim()));
}

/** close ≠ 修正。月末時点で未解決だったかを、イベント履歴ではなく現在値から近似する。 */
export function openAt(issue: NormalizedIssue, instantExclusive: string): boolean {
  if (issue.created_at >= instantExclusive) return false;
  if (issue.closed_at === null) return true;
  return issue.closed_at >= instantExclusive;
}
