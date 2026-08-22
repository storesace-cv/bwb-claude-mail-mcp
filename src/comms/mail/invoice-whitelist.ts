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
