#!/usr/bin/env python3
"""Apply BWB helpdesk context patches to claude-mail-mcp v0.2.1 (idempotent)."""
from __future__ import annotations

import pathlib
import shutil
import sys

MARKER = "bwb-helpdesk-context"
HERE = pathlib.Path(__file__).resolve().parent


def patch_file(path: pathlib.Path, needle: str, insert: str, once: bool = True) -> None:
    text = path.read_text(encoding="utf-8")
    if MARKER in text and insert.strip()[:40] in text:
        print(f"already patched: {path.name}")
        return
    if needle not in text:
        raise SystemExit(f"ERROR: needle not found in {path}")
    text = text.replace(needle, needle + insert, 1 if once else -1)
    path.write_text(text, encoding="utf-8")
    print(f"patched: {path.name}")


def main() -> int:
    backend = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "/var/www/mail-mcp")
    src = backend / "src"
    if not src.is_dir():
        raise SystemExit(f"ERROR: {src} missing")

    shutil.copyfile(HERE / "helpdesk-enrich.ts", src / "helpdesk-enrich.ts")
    shutil.copyfile(HERE / "tools-helpdesk.ts", src / "tools-helpdesk.ts")
    print("copied helpdesk-enrich.ts and tools-helpdesk.ts")

    # --- imap-client.ts ---
    imap = src / "imap-client.ts"
    text = imap.read_text(encoding="utf-8")
    if MARKER not in text:
        if "export interface MessageDetail extends MessageSummary" not in text:
            raise SystemExit("ERROR: MessageDetail not found")
        text = text.replace(
            "import { simpleParser, ParsedMail } from \"mailparser\";\n",
            "import { simpleParser, ParsedMail } from \"mailparser\";\n"
            f"import {{ enrichBwbFromMessage }} from \"./helpdesk-enrich.js\"; // {MARKER}\n",
            1,
        )
        old_iface = """export interface MessageDetail extends MessageSummary {
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  bodyText: string | null;
  bodyHtml: string | null;
  attachments: Array<{
    filename: string | null;
    contentType: string;
    size: number;
    contentId: string | null;
  }>;
}
"""
        new_iface = """export interface MessageDetail extends MessageSummary {
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  bodyText: string | null;
  bodyHtml: string | null;
  attachments: Array<{
    filename: string | null;
    contentType: string;
    size: number;
    contentId: string | null;
  }>;
  headersRelevant?: Record<string, string>; // """ + MARKER + """
  bwb?: ReturnType<typeof enrichBwbFromMessage>[\"bwb\"]; // """ + MARKER + """
}
"""
        if old_iface not in text:
            raise SystemExit("ERROR: MessageDetail block mismatch")
        text = text.replace(old_iface, new_iface, 1)

        old_return = """      return {
        uid: msg.uid as number,
        seq: msg.seq as number,
        flags: Array.from(msg.flags ?? []),
        date:
          (msg.internalDate as Date | undefined)?.toISOString() ?? null,
        subject: parsed.subject ?? null,
        from: parsed.from?.text ?? null,
        to: Array.isArray(parsed.to)
          ? parsed.to.map((a) => a.text).join(", ")
          : parsed.to?.text ?? null,
        cc: Array.isArray(parsed.cc)
          ? parsed.cc.map((a) => a.text).join(", ")
          : parsed.cc?.text ?? null,
        size: (msg.size as number | undefined) ?? null,
        preview: parsed.text ? parsed.text.slice(0, 200) : null,
        messageId: parsed.messageId ?? null,
        inReplyTo: parsed.inReplyTo ?? null,
        references: Array.isArray(parsed.references)
          ? parsed.references
          : parsed.references
            ? [parsed.references]
            : [],
        bodyText: parsed.text ?? null,
        bodyHtml: typeof parsed.html === "string" ? parsed.html : null,
        attachments: (parsed.attachments ?? []).map((a) => ({
          filename: a.filename ?? null,
          contentType: a.contentType,
          size: a.size,
          contentId: a.cid ?? null,
        })),
      };
"""
        new_return = """      const enriched = enrichBwbFromMessage({ // """ + MARKER + """
        subject: parsed.subject ?? null,
        from: parsed.from?.text ?? null,
        headers: parsed.headers as Map<string, unknown> | undefined,
      });
      return {
        uid: msg.uid as number,
        seq: msg.seq as number,
        flags: Array.from(msg.flags ?? []),
        date:
          (msg.internalDate as Date | undefined)?.toISOString() ?? null,
        subject: parsed.subject ?? null,
        from: parsed.from?.text ?? null,
        to: Array.isArray(parsed.to)
          ? parsed.to.map((a) => a.text).join(", ")
          : parsed.to?.text ?? null,
        cc: Array.isArray(parsed.cc)
          ? parsed.cc.map((a) => a.text).join(", ")
          : parsed.cc?.text ?? null,
        size: (msg.size as number | undefined) ?? null,
        preview: parsed.text ? parsed.text.slice(0, 200) : null,
        messageId: parsed.messageId ?? null,
        inReplyTo: parsed.inReplyTo ?? null,
        references: Array.isArray(parsed.references)
          ? parsed.references
          : parsed.references
            ? [parsed.references]
            : [],
        bodyText: parsed.text ?? null,
        bodyHtml: typeof parsed.html === "string" ? parsed.html : null,
        attachments: (parsed.attachments ?? []).map((a) => ({
          filename: a.filename ?? null,
          contentType: a.contentType,
          size: a.size,
          contentId: a.cid ?? null,
        })),
        headersRelevant: enriched.headersRelevant,
        bwb: enriched.bwb,
      };
"""
        if old_return not in text:
            raise SystemExit("ERROR: getMessage return block mismatch")
        text = text.replace(old_return, new_return, 1)
        imap.write_text(text, encoding="utf-8")
        print("patched: imap-client.ts")
    else:
        print("already patched: imap-client.ts")

    # --- config.ts ---
    cfg = src / "config.ts"
    ctext = cfg.read_text(encoding="utf-8")
    if MARKER not in ctext:
        needle = '  publicUrl: optional("PUBLIC_URL", "http://localhost:3220"),\n} as const;'
        insert = (
            '  publicUrl: optional("PUBLIC_URL", "http://localhost:3220"),\n'
            f'  helpdeskContextUrl: optional("HELPDESK_CONTEXT_URL", ""), // {MARKER}\n'
            f'  helpdeskContextToken: optional("HELPDESK_CONTEXT_TOKEN", ""), // {MARKER}\n'
            "} as const;"
        )
        if needle not in ctext:
            raise SystemExit("ERROR: config.ts publicUrl block not found")
        cfg.write_text(ctext.replace(needle, insert, 1), encoding="utf-8")
        print("patched: config.ts")
    else:
        print("already patched: config.ts")

    # --- index.ts ---
    idx = src / "index.ts"
    itext = idx.read_text(encoding="utf-8")
    if MARKER not in itext:
        itext = itext.replace(
            'import { registerCalendarTools } from "./tools-calendar.js";\n',
            'import { registerCalendarTools } from "./tools-calendar.js";\n'
            f'import {{ registerHelpdeskTools }} from "./tools-helpdesk.js"; // {MARKER}\n',
            1,
        )
        itext = itext.replace(
            "  registerMailTools(mcp, pool, store);\n  registerCalendarTools(mcp, pool);\n",
            "  registerMailTools(mcp, pool, store);\n  registerCalendarTools(mcp, pool);\n"
            f"  registerHelpdeskTools(mcp); // {MARKER}\n",
            1,
        )
        idx.write_text(itext, encoding="utf-8")
        print("patched: index.ts")
    else:
        print("already patched: index.ts")

    # --- tools-mail.ts description ---
    tm = src / "tools-mail.ts"
    ttext = tm.read_text(encoding="utf-8")
    if MARKER not in ttext:
        old = (
            '"Fetch one message by UID. Returns headers, full text+HTML body, '
            'attachment metadata (filenames + content types, NOT raw bytes), and '
            'threading IDs (Message-ID, In-Reply-To, References) for replies."'
        )
        new = (
            '"Fetch one message by UID. Returns headers, full text+HTML body, '
            "attachment metadata (filenames + content types, NOT raw bytes), threading IDs "
            "(Message-ID, In-Reply-To, References), plus BWB helpdesk enrichment fields "
            f'`bwb` and `headersRelevant` (X-BWB-* / Ticket#). Call helpdesk_ticket_context when bwb.ticket_number is set. ({MARKER})"'
        )
        if old not in ttext:
            raise SystemExit("ERROR: get_message description not found")
        tm.write_text(ttext.replace(old, new, 1), encoding="utf-8")
        print("patched: tools-mail.ts")
    else:
        print("already patched: tools-mail.ts")

    print("OK mail-v0.2.1 helpdesk patches applied")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
