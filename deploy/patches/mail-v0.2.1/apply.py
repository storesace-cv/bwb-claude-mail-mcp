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
    shutil.copyfile(HERE / "tools-mail-complete.ts", src / "tools-mail-complete.ts")
    shutil.copyfile(HERE / "tools-calendar-complete.ts", src / "tools-calendar-complete.ts")
    shutil.copyfile(HERE / "oauth-tokens.ts", src / "oauth-tokens.ts")
    print("copied helpdesk + mail-complete + calendar-complete + oauth-tokens sources")

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
            f'import {{ registerHelpdeskTools }} from "./tools-helpdesk.js"; // {MARKER}\n'
            f'import {{ registerMailCompleteTools }} from "./tools-mail-complete.js"; // {MARKER}\n'
            f'import {{ registerCalendarCompleteTools }} from "./tools-calendar-complete.js"; // {MARKER}\n',
            1,
        )
        itext = itext.replace(
            "  registerMailTools(mcp, pool, store);\n  registerCalendarTools(mcp, pool);\n",
            "  registerMailTools(mcp, pool, store);\n  registerCalendarTools(mcp, pool);\n"
            f"  registerHelpdeskTools(mcp); // {MARKER}\n"
            f"  registerMailCompleteTools(mcp, pool); // {MARKER}\n"
            f"  registerCalendarCompleteTools(mcp, pool); // {MARKER}\n",
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
    apply_mail_complete(src)
    apply_calendar_complete(src)
    print("OK mail-v0.2.1 BWB patches applied (helpdesk + folders + complete)")
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


MARKER_COMPLETE = "bwb-mail-complete"
MARKER_CAL = "bwb-calendar-complete"


def apply_mail_complete(src: pathlib.Path) -> None:
    imap = src / "imap-client.ts"
    text = imap.read_text(encoding="utf-8")
    if MARKER_COMPLETE not in text:
        needle = "  private async fetchRange(\n"
        if needle not in text:
            raise SystemExit("ERROR: private fetchRange not found for mail-complete")
        methods = r'''
  /** Copy message between mailboxes (IMAP COPY). // ''' + MARKER_COMPLETE + r''' */
  async copyMessage(
    sourceMailbox: string,
    uid: number,
    destinationMailbox: string
  ): Promise<void> {
    const client = await this.ensureConnected();
    const lock = await client.getMailboxLock(sourceMailbox);
    try {
      await client.messageCopy(`${uid}`, destinationMailbox, { uid: true });
    } finally {
      lock.release();
    }
  }

  async renameFolder(
    path: string,
    newPath: string
  ): Promise<{ path: string; new_path: string }> {
    const from = path.trim();
    const to = newPath.trim();
    if (!from || !to) throw new Error("path and new_path are required");
    if (from.toUpperCase() === "INBOX") {
      throw new Error("Refusing to rename INBOX");
    }
    const client = await this.ensureConnected();
    await client.mailboxRename(from, to);
    try {
      await client.mailboxSubscribe(to);
    } catch {
      // best effort
    }
    return { path: from, new_path: to };
  }

  async deleteFolder(path: string): Promise<{ path: string; deleted: boolean }> {
    const trimmed = path.trim();
    if (!trimmed) throw new Error("path is required");
    if (trimmed.toUpperCase() === "INBOX") {
      throw new Error("Refusing to delete INBOX");
    }
    const client = await this.ensureConnected();
    await client.mailboxDelete(trimmed);
    return { path: trimmed, deleted: true };
  }

  async markFlagged(
    mailbox: string,
    uid: number,
    flagged: boolean
  ): Promise<void> {
    const client = await this.ensureConnected();
    const lock = await client.getMailboxLock(mailbox);
    try {
      if (flagged) {
        await client.messageFlagsAdd(`${uid}`, ["\\Flagged"], { uid: true });
      } else {
        await client.messageFlagsRemove(`${uid}`, ["\\Flagged"], { uid: true });
      }
    } finally {
      lock.release();
    }
  }

  async folderStatus(path: string): Promise<{
    path: string;
    messages: number | null;
    unseen: number | null;
    uidNext: number | null;
    uidValidity: number | null;
  }> {
    const trimmed = path.trim();
    if (!trimmed) throw new Error("path is required");
    const client = await this.ensureConnected();
    const st = await client.status(trimmed, {
      messages: true,
      unseen: true,
      uidNext: true,
      uidValidity: true,
    });
    return {
      path: trimmed,
      messages: st.messages != null ? Number(st.messages) : null,
      unseen: st.unseen != null ? Number(st.unseen) : null,
      uidNext: st.uidNext != null ? Number(st.uidNext) : null,
      uidValidity: st.uidValidity != null ? Number(st.uidValidity) : null,
    };
  }

  async getAttachment(
    mailbox: string,
    uid: number,
    opts: { index?: number; filename?: string; maxBytes?: number }
  ): Promise<{
    filename: string | null;
    contentType: string;
    size: number;
    encoding: "base64";
    content_base64: string;
    truncated: boolean;
  }> {
    const maxBytes = opts.maxBytes ?? 5 * 1024 * 1024;
    const client = await this.ensureConnected();
    const lock = await client.getMailboxLock(mailbox);
    try {
      const msg = await client.fetchOne(
        `${uid}`,
        { source: true },
        { uid: true }
      );
      if (!msg) {
        throw new Error(`Message UID ${uid} not found in ${mailbox}`);
      }
      const parsed: ParsedMail = await simpleParser(msg.source as Buffer);
      const list = parsed.attachments ?? [];
      if (list.length === 0) {
        throw new Error("Message has no attachments");
      }
      let att = null as (typeof list)[number] | null;
      if (opts.index !== undefined) {
        att = list[opts.index] ?? null;
        if (!att) {
          throw new Error(
            `Attachment index ${opts.index} out of range (0..${list.length - 1})`
          );
        }
      } else if (opts.filename) {
        att =
          list.find((a) => (a.filename || "") === opts.filename) ??
          list.find(
            (a) =>
              (a.filename || "").toLowerCase() ===
              (opts.filename || "").toLowerCase()
          ) ??
          null;
        if (!att) {
          throw new Error(`Attachment filename not found: ${opts.filename}`);
        }
      } else {
        throw new Error("Need index or filename");
      }
      const buf = Buffer.isBuffer(att.content)
        ? att.content
        : Buffer.from(att.content || []);
      if (buf.length > maxBytes) {
        throw new Error(
          `Attachment is ${buf.length} bytes; max_bytes=${maxBytes}. Increase max_bytes (cap 15MiB) or download outside MCP.`
        );
      }
      return {
        filename: att.filename ?? null,
        contentType: att.contentType || "application/octet-stream",
        size: buf.length,
        encoding: "base64",
        content_base64: buf.toString("base64"),
        truncated: false,
      };
    } finally {
      lock.release();
    }
  }

'''
        imap.write_text(text.replace(needle, methods + needle, 1), encoding="utf-8")
        print("patched: imap-client.ts (mail-complete)")
    else:
        print("already patched: imap-client.ts (mail-complete)")

    # Ensure index registers mail-complete even on older helpdesk-only patches
    idx = src / "index.ts"
    itext = idx.read_text(encoding="utf-8")
    if "registerMailCompleteTools" not in itext:
        if 'import { registerHelpdeskTools } from "./tools-helpdesk.js";' in itext:
            itext = itext.replace(
                'import { registerHelpdeskTools } from "./tools-helpdesk.js"; // bwb-helpdesk-context\n',
                'import { registerHelpdeskTools } from "./tools-helpdesk.js"; // bwb-helpdesk-context\n'
                'import { registerMailCompleteTools } from "./tools-mail-complete.js"; // bwb-mail-complete\n'
                'import { registerCalendarCompleteTools } from "./tools-calendar-complete.js"; // bwb-calendar-complete\n',
                1,
            )
            itext = itext.replace(
                "  registerHelpdeskTools(mcp); // bwb-helpdesk-context\n",
                "  registerHelpdeskTools(mcp); // bwb-helpdesk-context\n"
                "  registerMailCompleteTools(mcp, pool); // bwb-mail-complete\n"
                "  registerCalendarCompleteTools(mcp, pool); // bwb-calendar-complete\n",
                1,
            )
            idx.write_text(itext, encoding="utf-8")
            print("patched: index.ts (mail/calendar complete)")
        else:
            raise SystemExit("ERROR: cannot register mail-complete tools in index.ts")
    else:
        print("already patched: index.ts (mail-complete)")


def apply_calendar_complete(src: pathlib.Path) -> None:
    cal = src / "caldav-client.ts"
    text = cal.read_text(encoding="utf-8")
    if MARKER_CAL not in text:
        needle = """  async createEvent(input: NewEventInput): Promise<{ url: string; uid: string }> {
    const calendar = await this.findCalendar(input.calendarUrl);
    const client = await this.ensureClient();
    const uid = `${randomUUID()}@claude-mail-mcp`;
    const ics = buildIcs({ ...input, uid });
    const filename = `${uid}.ics`;
    await client.createCalendarObject({
      calendar,
      filename,
      iCalString: ics,
    });
    const base = calendar.url.endsWith("/") ? calendar.url : `${calendar.url}/`;
    return { url: `${base}${filename}`, uid };
  }

  async findFreeSlots(
"""
        insert = """  async createEvent(input: NewEventInput): Promise<{ url: string; uid: string }> {
    const calendar = await this.findCalendar(input.calendarUrl);
    const client = await this.ensureClient();
    const uid = `${randomUUID()}@claude-mail-mcp`;
    const ics = buildIcs({ ...input, uid });
    const filename = `${uid}.ics`;
    await client.createCalendarObject({
      calendar,
      filename,
      iCalString: ics,
    });
    const base = calendar.url.endsWith("/") ? calendar.url : `${calendar.url}/`;
    return { url: `${base}${filename}`, uid };
  }

  /** Delete calendar object by URL. // """ + MARKER_CAL + """ */
  async deleteEvent(eventUrl: string): Promise<void> {
    const client = await this.ensureClient();
    await client.deleteCalendarObject({
      calendarObject: { url: eventUrl },
    });
  }

  /** Replace calendar object contents. // """ + MARKER_CAL + """ */
  async updateEvent(
    input: NewEventInput & { eventUrl: string; uid?: string }
  ): Promise<{ url: string; uid: string }> {
    const client = await this.ensureClient();
    const uid =
      input.uid ||
      input.eventUrl.split("/").filter(Boolean).pop()?.replace(/\\.ics$/i, "") ||
      `${randomUUID()}@claude-mail-mcp`;
    const ics = buildIcs({ ...input, uid });
    await client.updateCalendarObject({
      calendarObject: {
        url: input.eventUrl,
        data: ics,
      },
    });
    return { url: input.eventUrl, uid };
  }

  async findFreeSlots(
"""
        if needle not in text:
            raise SystemExit("ERROR: createEvent/findFreeSlots block not found")
        cal.write_text(text.replace(needle, insert, 1), encoding="utf-8")
        print("patched: caldav-client.ts (delete/update)")
    else:
        print("already patched: caldav-client.ts")

    apply_oauth_xoauth2(src)
    return 0


MARKER_OAUTH = "bwb-mail-oauth"


def apply_oauth_xoauth2(src: pathlib.Path) -> None:
    """Allow oauth2 accounts + XOAUTH2 on IMAP/SMTP (personal Microsoft/Google)."""
    accounts = src / "accounts.ts"
    text = accounts.read_text(encoding="utf-8")
    if MARKER_OAUTH not in text:
        needle = """export interface Account {
  id: string;
  label: string;
  default?: boolean;
  imap: ImapCreds;
  smtp: SmtpCreds;
  mail: MailDefaults;
  caldav?: CalDavCreds;
}
"""
        insert = """export interface AccountOAuth { // """ + MARKER_OAUTH + """
  provider: "microsoft" | "google";
  refreshToken: string;
  accessToken: string;
  expiresAt: number;
  email: string;
}

export interface Account {
  id: string;
  label: string;
  default?: boolean;
  provider?: string; // """ + MARKER_OAUTH + """
  authType?: "password" | "oauth2"; // """ + MARKER_OAUTH + """
  imap: ImapCreds;
  smtp: SmtpCreds;
  mail: MailDefaults;
  caldav?: CalDavCreds;
  oauth?: AccountOAuth; // """ + MARKER_OAUTH + """
}
"""
        if needle not in text:
            raise SystemExit("ERROR: Account interface not found for oauth patch")
        text = text.replace(needle, insert, 1)

        old_parse = """  return {
    id,
    label: expectStr(a.label, `accounts[${index}].label`),
    default: a.default === true ? true : undefined,
    imap: parseImap(a.imap, `accounts[${index}].imap`),
    smtp: parseSmtp(a.smtp, `accounts[${index}].smtp`),
    mail: parseMail(a.mail, `accounts[${index}].mail`),
    caldav: a.caldav ? parseCalDav(a.caldav, `accounts[${index}].caldav`) : undefined,
  };
}"""
        new_parse = """  const authType = a.authType === "oauth2" ? "oauth2" as const : a.authType === "password" ? "password" as const : undefined; // """ + MARKER_OAUTH + """
  const oauth = a.oauth && typeof a.oauth === "object" ? parseOAuth(a.oauth, `accounts[${index}].oauth`) : undefined; // """ + MARKER_OAUTH + """
  const imap = parseImap(a.imap, `accounts[${index}].imap`, Boolean(oauth));
  const smtp = parseSmtp(a.smtp, `accounts[${index}].smtp`, Boolean(oauth));
  if (!oauth && (!imap.pass || !smtp.pass)) {
    throw new AccountsStoreError(`accounts[${index}] requires imap/smtp pass or oauth`);
  }
  return {
    id,
    label: expectStr(a.label, `accounts[${index}].label`),
    default: a.default === true ? true : undefined,
    provider: typeof a.provider === "string" ? a.provider : undefined,
    authType: authType ?? (oauth ? "oauth2" : "password"),
    imap,
    smtp,
    mail: parseMail(a.mail, `accounts[${index}].mail`),
    caldav: a.caldav ? parseCalDav(a.caldav, `accounts[${index}].caldav`) : undefined,
    oauth,
  };
}

function parseOAuth(raw: unknown, where: string): AccountOAuth { // """ + MARKER_OAUTH + """
  if (!raw || typeof raw !== "object") throw new AccountsStoreError(`${where} must be an object`);
  const o = raw as Record<string, unknown>;
  const provider = o.provider === "google" ? "google" as const : o.provider === "microsoft" ? "microsoft" as const : null;
  if (!provider) throw new AccountsStoreError(`${where}.provider must be microsoft|google`);
  return {
    provider,
    refreshToken: expectStr(o.refreshToken, `${where}.refreshToken`),
    accessToken: expectStr(o.accessToken, `${where}.accessToken`),
    expiresAt: typeof o.expiresAt === "number" ? o.expiresAt : expectInt(o.expiresAt, `${where}.expiresAt`),
    email: expectStr(o.email, `${where}.email`),
  };
}"""
        if old_parse not in text:
            raise SystemExit("ERROR: parseAccount return block not found")
        text = text.replace(old_parse, new_parse, 1)

        text = text.replace(
            "function parseImap(raw: unknown, where: string): ImapCreds {",
            "function parseImap(raw: unknown, where: string, allowEmptyPass = false): ImapCreds { // "
            + MARKER_OAUTH
            + "\n",
            1,
        )
        text = text.replace(
            "function parseSmtp(raw: unknown, where: string): SmtpCreds {",
            "function parseSmtp(raw: unknown, where: string, allowEmptyPass = false): SmtpCreds { // "
            + MARKER_OAUTH
            + "\n",
            1,
        )
        text = text.replace(
            "    pass: expectStr(o.pass, `${where}.pass`),\n    tls: typeof o.tls === \"boolean\" ? o.tls : true,\n  };\n}\n\nfunction parseSmtp",
            "    pass: allowEmptyPass && (o.pass === \"\" || o.pass === undefined) ? \"\" : expectStr(o.pass, `${where}.pass`),\n    tls: typeof o.tls === \"boolean\" ? o.tls : true,\n  };\n}\n\nfunction parseSmtp",
            1,
        )
        # second pass for smtp - after parseImap was changed the smtp still has expectStr
        text = text.replace(
            """function parseSmtp(raw: unknown, where: string, allowEmptyPass = false): SmtpCreds { // """
            + MARKER_OAUTH
            + """
  if (!raw || typeof raw !== "object") {
    throw new AccountsStoreError(`${where} must be an object`);
  }
  const o = raw as Record<string, unknown>;
  return {
    host: expectStr(o.host, `${where}.host`),
    port: expectInt(o.port, `${where}.port`),
    user: expectStr(o.user, `${where}.user`),
    pass: expectStr(o.pass, `${where}.pass`),
    tls: typeof o.tls === "boolean" ? o.tls : true,
  };
}""",
            """function parseSmtp(raw: unknown, where: string, allowEmptyPass = false): SmtpCreds { // """
            + MARKER_OAUTH
            + """
  if (!raw || typeof raw !== "object") {
    throw new AccountsStoreError(`${where} must be an object`);
  }
  const o = raw as Record<string, unknown>;
  return {
    host: expectStr(o.host, `${where}.host`),
    port: expectInt(o.port, `${where}.port`),
    user: expectStr(o.user, `${where}.user`),
    pass: allowEmptyPass && (o.pass === "" || o.pass === undefined) ? "" : expectStr(o.pass, `${where}.pass`),
    tls: typeof o.tls === "boolean" ? o.tls : true,
  };
}""",
            1,
        )
        accounts.write_text(text, encoding="utf-8")
        print("patched: accounts.ts (oauth)")
    else:
        print("already patched: accounts.ts (oauth)")

    imap = src / "imap-client.ts"
    text = imap.read_text(encoding="utf-8")
    if MARKER_OAUTH not in text:
        text = text.replace(
            """export interface ImapAuth {
  host: string;
  port: number;
  user: string;
  pass: string;
  secure: boolean;
}
""",
            """export interface ImapAuth {
  host: string;
  port: number;
  user: string;
  pass?: string;
  accessToken?: string; // """
            + MARKER_OAUTH
            + """
  secure: boolean;
}
""",
            1,
        )
        text = text.replace(
            """  constructor(auth: ImapAuth) {
    this.opts = {
      host: auth.host,
      port: auth.port,
      secure: auth.secure,
      auth: { user: auth.user, pass: auth.pass },
      logger: false,
    };
  }
""",
            """  private tokenRefresh?: () => Promise<{ user: string; accessToken: string }>; // """
            + MARKER_OAUTH
            + """

  constructor(auth: ImapAuth, tokenRefresh?: () => Promise<{ user: string; accessToken: string }>) {
    this.tokenRefresh = tokenRefresh;
    this.opts = {
      host: auth.host,
      port: auth.port,
      secure: auth.secure,
      auth: auth.accessToken
        ? { user: auth.user, accessToken: auth.accessToken }
        : { user: auth.user, pass: auth.pass ?? "" },
      logger: false,
    };
  }
""",
            1,
        )
        text = text.replace(
            """  private async ensureConnected(): Promise<ImapFlow> {
    if (this.client && this.client.usable) return this.client;
    if (this.connecting) return this.connecting;
    this.connecting = (async (): Promise<ImapFlow> => {
      const client = new ImapFlow(this.opts);
""",
            """  private async ensureConnected(): Promise<ImapFlow> {
    if (this.client && this.client.usable) return this.client;
    if (this.connecting) return this.connecting;
    this.connecting = (async (): Promise<ImapFlow> => {
      if (this.tokenRefresh) { // """
            + MARKER_OAUTH
            + """
        const t = await this.tokenRefresh();
        this.opts.auth = { user: t.user, accessToken: t.accessToken };
      }
      const client = new ImapFlow(this.opts);
""",
            1,
        )
        imap.write_text(text, encoding="utf-8")
        print("patched: imap-client.ts (oauth)")
    else:
        print("already patched: imap-client.ts (oauth)")

    smtp = src / "smtp-client.ts"
    text = smtp.read_text(encoding="utf-8")
    if MARKER_OAUTH not in text:
        text = text.replace(
            """export interface SmtpAuth {
  host: string;
  port: number;
  user: string;
  pass: string;
  secure: boolean;
}
""",
            """export interface SmtpAuth {
  host: string;
  port: number;
  user: string;
  pass?: string;
  accessToken?: string; // """
            + MARKER_OAUTH
            + """
  secure: boolean;
}
""",
            1,
        )
        text = text.replace(
            """export class SmtpClient {
  private readonly transporter: Transporter;
  private readonly defaults: SmtpDefaults;

  constructor(auth: SmtpAuth, defaults: SmtpDefaults) {
    this.transporter = nodemailer.createTransport({
      host: auth.host,
      port: auth.port,
      secure: auth.secure,
      auth: { user: auth.user, pass: auth.pass },
    });
    this.defaults = defaults;
  }

  async send(msg: OutgoingMessage): Promise<SendResult> {
    const mail = this.toMailOptions(msg);
    const info = await this.transporter.sendMail(mail);
""",
            """export class SmtpClient {
  private transporter: Transporter;
  private readonly defaults: SmtpDefaults;
  private readonly auth: SmtpAuth;
  private tokenRefresh?: () => Promise<{ user: string; accessToken: string }>; // """
            + MARKER_OAUTH
            + """

  constructor(
    auth: SmtpAuth,
    defaults: SmtpDefaults,
    tokenRefresh?: () => Promise<{ user: string; accessToken: string }>
  ) {
    this.auth = auth;
    this.tokenRefresh = tokenRefresh;
    this.defaults = defaults;
    this.transporter = this.buildTransport(auth);
  }

  private buildTransport(auth: SmtpAuth): Transporter { // """
            + MARKER_OAUTH
            + """
    const port = auth.port;
    const secure = Boolean(auth.secure) && port === 465;
    return nodemailer.createTransport({
      host: auth.host,
      port,
      secure,
      requireTLS: !secure && Boolean(auth.secure),
      auth: auth.accessToken
        ? { user: auth.user, accessToken: auth.accessToken, method: "XOAUTH2" }
        : { user: auth.user, pass: auth.pass ?? "" },
    });
  }

  async send(msg: OutgoingMessage): Promise<SendResult> {
    if (this.tokenRefresh) { // """
            + MARKER_OAUTH
            + """
      const t = await this.tokenRefresh();
      this.transporter = this.buildTransport({ ...this.auth, user: t.user, accessToken: t.accessToken, pass: undefined });
    }
    const mail = this.toMailOptions(msg);
    const info = await this.transporter.sendMail(mail);
""",
            1,
        )
        smtp.write_text(text, encoding="utf-8")
        print("patched: smtp-client.ts (oauth)")
    else:
        print("already patched: smtp-client.ts (oauth)")

    pool = src / "client-pool.ts"
    text = pool.read_text(encoding="utf-8")
    if MARKER_OAUTH not in text:
        if 'from "./oauth-tokens.js"' not in text:
            text = text.replace(
                'import { Account, AccountsStore } from "./accounts.js";\n',
                'import { Account, AccountsStore } from "./accounts.js";\n'
                f'import {{ ensureOAuthAccessToken, accountsFilePath }} from "./oauth-tokens.js"; // {MARKER_OAUTH}\n',
                1,
            )
        old_build = """  private build(account: Account): AccountClients {
    const imap = new ImapClient({
      host: account.imap.host,
      port: account.imap.port,
      user: account.imap.user,
      pass: account.imap.pass,
      secure: account.imap.tls,
    });
    const smtp = new SmtpClient(
      {
        host: account.smtp.host,
        port: account.smtp.port,
        user: account.smtp.user,
        pass: account.smtp.pass,
        secure: account.smtp.tls,
      },
      {
        from: account.mail.defaultFrom,
        fromName: account.mail.defaultFromName || undefined,
      }
    );
"""
        new_build = """  private build(account: Account): AccountClients {
    const file = accountsFilePath(); // """ + MARKER_OAUTH + """
    const useOauth = account.authType === "oauth2" && Boolean(account.oauth?.accessToken);
    const tokenRefresh = useOauth
      ? async () => {
          const fresh = await ensureOAuthAccessToken(account, file);
          account = fresh;
          if (!fresh.oauth?.accessToken) throw new Error("OAuth access token missing after refresh");
          return { user: fresh.imap.user, accessToken: fresh.oauth.accessToken };
        }
      : undefined;
    const imap = new ImapClient(
      {
        host: account.imap.host,
        port: account.imap.port,
        user: account.imap.user,
        pass: useOauth ? undefined : account.imap.pass,
        accessToken: useOauth ? account.oauth!.accessToken : undefined,
        secure: account.imap.tls,
      },
      tokenRefresh
    );
    const smtp = new SmtpClient(
      {
        host: account.smtp.host,
        port: account.smtp.port,
        user: account.smtp.user,
        pass: useOauth ? undefined : account.smtp.pass,
        accessToken: useOauth ? account.oauth!.accessToken : undefined,
        secure: account.smtp.tls,
      },
      {
        from: account.mail.defaultFrom,
        fromName: account.mail.defaultFromName || undefined,
      },
      tokenRefresh
    );
"""
        if old_build not in text:
            raise SystemExit("ERROR: client-pool build block not found")
        text = text.replace(old_build, new_build, 1)
        pool.write_text(text, encoding="utf-8")
        print("patched: client-pool.ts (oauth)")
    else:
        print("already patched: client-pool.ts (oauth)")


if __name__ == "__main__":
    raise SystemExit(main())
