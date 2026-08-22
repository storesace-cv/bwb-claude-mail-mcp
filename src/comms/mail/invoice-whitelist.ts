export type InvoiceStage = "seed" | "review" | "active";

export function foldText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** One line: alternatives split by `;`, each alternative AND-parts split by `&`. */
export function parseWhitelistLines(raw: string): string[][][] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) =>
      line
        .split(";")
        .map((alt) =>
          alt
            .split("&")
            .map((p) => foldText(p))
            .filter(Boolean)
        )
        .filter((parts) => parts.length > 0)
    )
    .filter((alts) => alts.length > 0);
}

export function haystackHasAll(haystack: string, words: string[]): boolean {
  const h = foldText(haystack);
  return words.every((w) => h.includes(w));
}

export function lineMatches(haystack: string, alternatives: string[][]): boolean {
  return alternatives.some((words) => haystackHasAll(haystack, words));
}

export function listMatches(haystack: string, rawList: string): boolean {
  const lines = parseWhitelistLines(rawList);
  if (!lines.length) return false;
  return lines.some((alts) => lineMatches(haystack, alts));
}

export function documentAccepted(
  extractedText: string,
  issuersRaw: string,
  recipientsRaw: string
): boolean {
  const body = extractedText.trim();
  if (!body) return false;
  return listMatches(body, issuersRaw) || listMatches(body, recipientsRaw);
}

export function shouldKeepInvoice(
  stage: InvoiceStage,
  extractedText: string,
  issuersRaw: string,
  recipientsRaw: string
): boolean {
  if (stage === "seed") return true;
  if (stage === "review") return false;
  return documentAccepted(extractedText, issuersRaw, recipientsRaw);
}

export function recipientLinesNonEmpty(raw: string): boolean {
  return parseWhitelistLines(raw).length > 0;
}

export function whitelistHasEntries(issuers: string, recipients: string): boolean {
  return recipientLinesNonEmpty(issuers) || recipientLinesNonEmpty(recipients);
}

/** Keep a stored invoice only if it is within the age window and, when lists exist, matches them. */
export function shouldKeepStoredInvoice(opts: {
  dateMs: number;
  cutoffMs: number;
  extractedText: string;
  issuers: string;
  recipients: string;
}): boolean {
  if (!Number.isFinite(opts.dateMs) || opts.dateMs < opts.cutoffMs) return false;
  if (!whitelistHasEntries(opts.issuers, opts.recipients)) return true;
  return documentAccepted(opts.extractedText, opts.issuers, opts.recipients);
}

/** Keyword lines for the issuer list from an email From header (name AND-words + email). */
export function issuerLinesFromFromHeader(fromHeader: string): string[] {
  const raw = fromHeader.trim();
  if (!raw) return [];
  const out: string[] = [];
  const email = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (email) out.push(email[0].toLowerCase());
  const name = raw
    .replace(/<[^>]+>/g, " ")
    .replace(/"/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = name
    .split(" ")
    .map((w) => w.replace(/[,;]+/g, ""))
    .filter((w) => w.length > 1 && !w.includes("@"));
  if (words.length >= 2) out.push(words.join("&"));
  else if (words.length === 1) out.push(words[0]);
  return [...new Set(out)];
}

export function mergeWhitelistLines(existing: string, extra: string[]): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const line of [...existing.split(/\r?\n/), ...extra]) {
    const t = line.trim();
    if (!t) continue;
    const key = foldText(t);
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(t);
  }
  return lines.sort((a, b) => a.localeCompare(b, "pt")).join("\n");
}

