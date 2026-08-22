function normalize(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

export function matchesKeywords(text: string, keywordsCsv: string): boolean {
  const terms = keywordsCsv
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  if (!terms.length) return matchesAgtKeywords(text);
  const n = normalize(text);
  return terms.some((term) => n.includes(normalize(term))) || matchesAgtKeywords(text);
}

const PATTERNS: RegExp[] = [
  /fatura[cç][aã]o\s+eletr[oó]nica/i,
  /factura[cç][aã]o\s+electr[oó]nica/i,
  /fatura[cç][aã]o\s+electr[oó]nica/i,
  /saft[\s-]?ao/i,
  /certifica(?:ção|cao|do|r)/i,
  /\biva\b/i,
];

export function matchesAgtKeywords(text: string): boolean {
  const t = text.normalize("NFD").replace(/\p{M}/gu, "");
  if (PATTERNS.some((re) => re.test(text))) return true;
  return /faturacao\s+eletronica|factura[cç]ao|saftao|\biva\b|certifica/i.test(t);
}
