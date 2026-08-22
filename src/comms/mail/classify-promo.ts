import { listMailRules, type MailRule } from "../rules/store.js";

export type PromoBucket = string | null;

const PROMO_RE = /desconto|oferta|\bsale\b|%\s*off|poupe|urg[eê]ncia|esgot|promo/i;
const DIGEST_RE = /newsletter|digest|boletim|\bupdate\b/i;
const BCN_SUBJ = /cart[aã]o|pre[cç][aá]rio|atualize os seus dados/i;
const INVOICE_RE = /fatura|factura|invoice|recibo|billing|pagamento|receipt/i;
const SECURITY_RE = /login|security|seguran[cç]a|password|2fa|verifica/i;

function subjectMatches(subject: string, blob: string, pattern: string): boolean {
  if (pattern.includes("|")) {
    try {
      return new RegExp(pattern, "i").test(blob);
    } catch {
      return subject.toLowerCase().includes(pattern.toLowerCase());
    }
  }
  return subject.toLowerCase().includes(pattern.toLowerCase()) || blob.toLowerCase().includes(pattern.toLowerCase());
}

function accountMatches(rule: MailRule, accountId?: string): boolean {
  if (rule.accountId === "*") return true;
  if (!accountId) return true;
  return rule.accountId === accountId;
}

function ruleMatches(rule: MailRule, from: string, subject: string, blob: string): boolean {
  if (rule.catchInvoice) {
    return INVOICE_RE.test(blob) && !from.includes("news.paypal");
  }
  if (rule.catchSecurity) {
    return SECURITY_RE.test(blob) && !BCN_SUBJ.test(subject);
  }
  if (rule.catchPromo) return PROMO_RE.test(blob);
  if (rule.catchDigest) {
    return DIGEST_RE.test(blob) && /noreply|no-reply|newsletter|digest|news@/i.test(from);
  }
  if (rule.odooNotifications) {
    return from.includes("notifications@") && from.includes("odoo.com");
  }
  if (rule.splitPromo) {
    const fromOk = rule.matchFrom ? from.includes(rule.matchFrom.toLowerCase()) : true;
    return fromOk && PROMO_RE.test(blob);
  }

  const checks: boolean[] = [];
  if (rule.matchFrom) checks.push(from.includes(rule.matchFrom.toLowerCase()));
  if (rule.fromDomain) checks.push(from.includes(rule.fromDomain.toLowerCase()));
  if (rule.subjectPrefix) checks.push(subject.trim().startsWith(rule.subjectPrefix));
  if (rule.matchSubject) checks.push(subjectMatches(subject, blob, rule.matchSubject));
  if (!checks.length) return false;
  return checks.every(Boolean);
}

export function classifyPromoWithRules(
  input: { fromHeader: string; subject: string; bodyPreview?: string; accountId?: string },
  rules: MailRule[]
): PromoBucket {
  const from = input.fromHeader.toLowerCase();
  const subject = input.subject;
  const blob = `${subject}\n${input.bodyPreview ?? ""}`;
  const enabled = rules.filter((r) => r.enabled && accountMatches(r, input.accountId));

  for (const rule of enabled.filter((r) => r.kind === "keep" || r.catchInvoice || r.catchSecurity)) {
    if (ruleMatches(rule, from, subject, blob)) return null;
  }

  const specific = enabled.filter(
    (r) =>
      r.kind !== "keep" &&
      r.kind !== "helpdesk" &&
      !r.catchPromo &&
      !r.catchDigest &&
      !r.catchInvoice &&
      !r.catchSecurity
  );
  for (const rule of specific) {
    if (ruleMatches(rule, from, subject, blob) && rule.destFolder) return rule.destFolder;
  }

  for (const rule of enabled.filter((r) => r.catchPromo || r.catchDigest)) {
    if (ruleMatches(rule, from, subject, blob) && rule.destFolder) return rule.destFolder;
  }
  return null;
}

export function classifyPromo(input: {
  fromHeader: string;
  subject: string;
  bodyPreview?: string;
  accountId?: string;
}): PromoBucket {
  return classifyPromoWithRules(input, listMailRules(true));
}

export function purgeDaysByFolder(rules: MailRule[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of rules) {
    if (!r.enabled || !r.destFolder || r.purgeAfterDays <= 0) continue;
    const prev = map.get(r.destFolder) ?? r.purgeAfterDays;
    map.set(r.destFolder, Math.min(prev, r.purgeAfterDays));
  }
  return map;
}
