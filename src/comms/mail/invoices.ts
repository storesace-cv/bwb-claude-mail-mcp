const NAME_RE = /fatura|factura|invoice|recibo|nota[\s_-]*de[\s_-]*cr[eé]dito/i;
const SKIP_EXT = /\.(ics|vcf|eml|html?|txt|csv|zip)$/i;

export function isInvoiceCandidate(filename: string, mime: string): boolean {
  const name = filename.trim() || "attachment";
  if (SKIP_EXT.test(name)) return false;
  const mimeL = mime.toLowerCase();
  const isPdf = mimeL.includes("pdf") || name.toLowerCase().endsWith(".pdf");
  const isImage = mimeL.startsWith("image/");
  if (!isPdf && !isImage) return false;
  if (NAME_RE.test(name)) return true;
  if (isPdf) return true;
  return false;
}

export function extractPdfText(buf: Buffer, maxChars = 8000): string {
  if (buf.length < 5 || buf.subarray(0, 5).toString("latin1") !== "%PDF-") return "";
  const latin = buf.toString("latin1");
  const chunks: string[] = [];
  const re = /\((?:\\.|[^\\)]){3,400}\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(latin))) {
    const inner = m[0]
      .slice(1, -1)
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\n")
      .replace(/\\t/g, " ")
      .replace(/\\\(/g, "(")
      .replace(/\\\)/g, ")")
      .replace(/\\\\/g, "\\");
    if (/[A-Za-zÀ-ÿ0-9]{3,}/.test(inner)) chunks.push(inner);
    if (chunks.join(" ").length > maxChars) break;
  }
  return chunks.join(" ").replace(/\s+/g, " ").trim().slice(0, maxChars);
}
