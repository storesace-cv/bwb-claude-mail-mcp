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

    apply_create_folder(src)
    print("OK mail-v0.2.1 helpdesk + create_folder patches applied")
    return 0


MARKER_FOLDER = "bwb-create-folder"


def apply_create_folder(src: pathlib.Path) -> None:
    """IMAP CREATE + SUBSCRIBE tool (idempotent)."""
    imap = src / "imap-client.ts"
    text = imap.read_text(encoding="utf-8")
    if MARKER_FOLDER not in text:
        needle = """  async deleteMessage(mailbox: string, uid: number): Promise<void> {
    const client = await this.ensureConnected();
    const lock = await client.getMailboxLock(mailbox);
    try {
      await client.messageDelete(`${uid}`, { uid: true });
    } finally {
      lock.release();
    }
  }

  /**
   * Append a raw RFC 822 message to a folder — used for drafts and for
   * keeping a copy of sent messages.
   */
  async append(
"""
        insert = """  async deleteMessage(mailbox: string, uid: number): Promise<void> {
    const client = await this.ensureConnected();
    const lock = await client.getMailboxLock(mailbox);
    try {
      await client.messageDelete(`${uid}`, { uid: true });
    } finally {
      lock.release();
    }
  }

  /**
   * Create an IMAP mailbox (folder) and subscribe to it. // """ + MARKER_FOLDER + """
   * Idempotent: if the folder already exists, returns existed=true.
   */
  async createFolder(path: string): Promise<{
    path: string;
    created: boolean;
    existed: boolean;
    subscribed: boolean;
  }> {
    const trimmed = path.trim();
    if (!trimmed || trimmed === "." || trimmed === "..") {
      throw new Error("Invalid mailbox path");
    }
    if (trimmed.split(/[/]/).some((p) => p === "" || p === "." || p === "..")) {
      throw new Error("Mailbox path must not contain empty or '..' segments");
    }
    const client = await this.ensureConnected();
    let created = false;
    let existed = false;
    try {
      await client.mailboxCreate(trimmed);
      created = true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const already =
        /already exists|Mailbox exists|ALREADYEXISTS/i.test(msg) ||
        (typeof (err as { responseText?: string })?.responseText === "string" &&
          /already exists|Mailbox exists|ALREADYEXISTS/i.test(
            (err as { responseText: string }).responseText
          ));
      if (!already) throw err;
      existed = true;
    }
    let subscribed = false;
    try {
      await client.mailboxSubscribe(trimmed);
      subscribed = true;
    } catch {
      // Subscribe is best-effort on some servers after CREATE.
      subscribed = false;
    }
    return { path: trimmed, created, existed, subscribed };
  }

  /**
   * Append a raw RFC 822 message to a folder — used for drafts and for
   * keeping a copy of sent messages.
   */
  async append(
"""
        if needle not in text:
            raise SystemExit("ERROR: deleteMessage/append block not found for createFolder")
        imap.write_text(text.replace(needle, insert, 1), encoding="utf-8")
        print("patched: imap-client.ts (createFolder)")
    else:
        print("already patched: imap-client.ts (createFolder)")

    tm = src / "tools-mail.ts"
    ttext = tm.read_text(encoding="utf-8")
    if MARKER_FOLDER not in ttext:
        needle = """  server.registerTool(
    "move_message",
    {
      description:
        "Move a message from one mailbox to another (e.g. Inbox → Archive). WRITE OPERATION.",
      inputSchema: {
        source_mailbox: z.string(),
        uid: z.number().int().positive(),
        destination_mailbox: z.string(),
        account: accountSchema,
      },
    },
    async ({ source_mailbox, uid, destination_mailbox, account }) => {
      const { imap } = pool.for(account);
      await imap.moveMessage(source_mailbox, uid, destination_mailbox);
      return asJson({
        success: true,
        from: source_mailbox,
        to: destination_mailbox,
        uid,
      });
    }
  );

  server.registerTool(
    "delete_message",
"""
        insert = """  server.registerTool(
    "move_message",
    {
      description:
        "Move a message from one mailbox to another (e.g. Inbox → Archive). WRITE OPERATION.",
      inputSchema: {
        source_mailbox: z.string(),
        uid: z.number().int().positive(),
        destination_mailbox: z.string(),
        account: accountSchema,
      },
    },
    async ({ source_mailbox, uid, destination_mailbox, account }) => {
      const { imap } = pool.for(account);
      await imap.moveMessage(source_mailbox, uid, destination_mailbox);
      return asJson({
        success: true,
        from: source_mailbox,
        to: destination_mailbox,
        uid,
      });
    }
  );

  server.registerTool(
    "create_folder",
    {
      description:
        "Create a new IMAP mailbox/folder (IMAP CREATE) and SUBSCRIBE to it. WRITE OPERATION. Use when list_folders does not show the destination (e.g. INBOX.clientes.Kinda or INBOX.helpdesk.Kinda) before move_message. Idempotent if the folder already exists. (""" + MARKER_FOLDER + """)",
      inputSchema: {
        path: z
          .string()
          .min(1)
          .describe(
            "Full IMAP path for the new folder, e.g. INBOX.clientes.Kinda or INBOX.helpdesk.Kinda"
          ),
        account: accountSchema,
      },
    },
    async ({ path, account }) => {
      const { imap } = pool.for(account);
      const result = await imap.createFolder(path);
      return asJson({ success: true, ...result });
    }
  );

  server.registerTool(
    "delete_message",
"""
        if needle not in ttext:
            raise SystemExit("ERROR: move_message/delete_message block not found")
        tm.write_text(ttext.replace(needle, insert, 1), encoding="utf-8")
        print("patched: tools-mail.ts (create_folder)")
    else:
        print("already patched: tools-mail.ts (create_folder)")


if __name__ == "__main__":
    raise SystemExit(main())
