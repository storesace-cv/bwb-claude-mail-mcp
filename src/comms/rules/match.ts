export interface FolderRule {
  id: string;
  accountId: string;
  matchFrom: string;
  matchSubject: string;
  destFolder: string;
}

export function ruleMatches(
  rule: FolderRule,
  input: { accountId: string; fromHeader: string; subject: string }
): boolean {
  if (rule.accountId !== "*" && rule.accountId !== input.accountId) return false;
  const from = input.fromHeader.toLowerCase();
  const subject = input.subject.toLowerCase();
  const wantFrom = rule.matchFrom.trim().toLowerCase();
  const wantSubj = rule.matchSubject.trim().toLowerCase();
  if (!wantFrom && !wantSubj) return false;
  if (wantFrom && !from.includes(wantFrom)) return false;
  if (wantSubj && !subject.includes(wantSubj)) return false;
  return true;
}

/** Unique dest folder, or null if none / conflicting dests. */
export function uniqueMatchingDest(
  rules: FolderRule[],
  input: { accountId: string; fromHeader: string; subject: string }
): { destFolder: string; ruleId: string } | null {
  const hits = rules.filter((r) => ruleMatches(r, input));
  if (hits.length === 0) return null;
  const dests = new Set(hits.map((h) => h.destFolder));
  if (dests.size !== 1) return null;
  const first = hits[0];
  return { destFolder: first.destFolder, ruleId: first.id };
}
