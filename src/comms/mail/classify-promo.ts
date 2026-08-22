export type PromoBucket = "newsletters" | "marketing" | null;

const NEWSLETTER_FROM = [
  "news@alphasignal.ai",
  "notifications@kindafood.odoo.com",
];

const MARKETING_FROM = [
  "support@realmacsoftware.com",
  "broadcast@dealnotes.ai",
  "team@pcloud.email",
  "noreply@news.paypal.com",
  "emily@smtp2go.com",
  "team@sent.dm",
];

const NEVER_MOVE_FROM = [
  "helpdesk@bwb.pt",
  "team@pcloud.com",
];

const PROMO_RE = /desconto|oferta|\bsale\b|%\s*off|poupe|urg[eê]ncia|esgot|promo/i;
const DIGEST_RE = /newsletter|digest|boletim|\bupdate\b/i;
const BCN_SUBJ = /cart[aã]o|pre[cç][aá]rio|atualize os seus dados/i;
const INVOICE_RE = /fatura|factura|invoice|recibo|billing|pagamento|receipt/i;
const SECURITY_RE = /login|security|seguran[cç]a|password|2fa|verifica/i;

export function classifyPromo(input: {
  fromHeader: string;
  subject: string;
  bodyPreview?: string;
}): PromoBucket {
  const from = input.fromHeader.toLowerCase();
  const subject = input.subject;
  const blob = `${subject}\n${input.bodyPreview ?? ""}`;

  if (NEVER_MOVE_FROM.some((a) => from.includes(a))) return null;
  if (SECURITY_RE.test(blob) && !BCN_SUBJ.test(subject)) return null;
  if (INVOICE_RE.test(blob) && !from.includes("news.paypal")) return null;

  if (from.includes("welcome@supabase.com")) {
    return subject.trim().startsWith("Supa Update") ? "newsletters" : null;
  }
  if (NEWSLETTER_FROM.some((a) => from.includes(a))) return "newsletters";
  if (/notifications@[^@]+\.odoo\.com/i.test(from) || from.includes(".odoo.com")) {
    if (from.includes("notifications@")) return "newsletters";
  }
  if (from.includes("linkedin.com")) return "newsletters";
  if (BCN_SUBJ.test(subject) && /bcn|banco/i.test(from)) return "newsletters";

  if (MARKETING_FROM.some((a) => from.includes(a))) return "marketing";
  if (from.includes("microsoft") && /reward|ponto|points|earn/i.test(blob)) return "marketing";
  if (/endesa/i.test(from)) {
    return PROMO_RE.test(blob) ? "marketing" : null;
  }

  if (PROMO_RE.test(blob)) return "marketing";
  if (DIGEST_RE.test(blob) && /noreply|no-reply|newsletter|digest|news@/i.test(from)) {
    return "newsletters";
  }
  return null;
}
