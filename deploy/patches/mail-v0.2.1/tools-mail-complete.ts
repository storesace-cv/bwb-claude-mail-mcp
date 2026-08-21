/**
 * Extra mail tools (BWB) — copy, folder admin, flags, attachments, status.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ClientPool } from "./client-pool.js";

function asJson(value: unknown): { content: { type: "text"; text: string }[] } {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

const accountSchema = z
  .string()
  .optional()
  .describe(
    "Account ID (from list_accounts) to act on. Omit to use the default account."
  );

export function registerMailCompleteTools(
  server: McpServer,
  pool: ClientPool
): void {
  server.registerTool(
    "copy_message",
    {
      description:
        "Copy a message to another mailbox without removing the original (IMAP COPY). WRITE OPERATION. Prefer move_message when archiving out of INBOX.",
      inputSchema: {
        source_mailbox: z.string(),
        uid: z.number().int().positive(),
        destination_mailbox: z.string(),
        account: accountSchema,
      },
    },
    async ({ source_mailbox, uid, destination_mailbox, account }) => {
      const { imap } = pool.for(account);
      await imap.copyMessage(source_mailbox, uid, destination_mailbox);
      return asJson({
        success: true,
        from: source_mailbox,
        to: destination_mailbox,
        uid,
      });
    }
  );

  server.registerTool(
    "rename_folder",
    {
      description:
        "Rename an IMAP mailbox (IMAP RENAME). WRITE OPERATION. Example: INBOX.clientes.Old → INBOX.clientes.New.",
      inputSchema: {
        path: z.string().min(1).describe("Current folder path"),
        new_path: z.string().min(1).describe("New folder path"),
        account: accountSchema,
      },
    },
    async ({ path, new_path, account }) => {
      const { imap } = pool.for(account);
      const result = await imap.renameFolder(path, new_path);
      return asJson({ success: true, ...result });
    }
  );

  server.registerTool(
    "delete_folder",
    {
      description:
        "Delete an IMAP mailbox (IMAP DELETE). DESTRUCTIVE — messages in the folder may be lost depending on the server. Prefer moving messages out first. Does not delete INBOX.",
      inputSchema: {
        path: z.string().min(1),
        account: accountSchema,
      },
    },
    async ({ path, account }) => {
      const { imap } = pool.for(account);
      const result = await imap.deleteFolder(path);
      return asJson({ success: true, ...result });
    }
  );

  server.registerTool(
    "mark_flagged",
    {
      description:
        "Set or clear the \\Flagged (starred/important) flag on a message. WRITE OPERATION but easily reversible.",
      inputSchema: {
        mailbox: z.string(),
        uid: z.number().int().positive(),
        flagged: z
          .boolean()
          .describe("true = flag/star, false = clear flag"),
        account: accountSchema,
      },
    },
    async ({ mailbox, uid, flagged, account }) => {
      const { imap } = pool.for(account);
      await imap.markFlagged(mailbox, uid, flagged);
      return asJson({ success: true, mailbox, uid, flagged });
    }
  );

  server.registerTool(
    "folder_status",
    {
      description:
        "IMAP STATUS for one mailbox: total messages, unseen (unread), uidNext, uidValidity. READ-ONLY. Useful before organizing Helpdesk mail.",
      inputSchema: {
        path: z.string().min(1).describe("Mailbox path, e.g. INBOX"),
        account: accountSchema,
      },
    },
    async ({ path, account }) => {
      const { imap } = pool.for(account);
      return asJson(await imap.folderStatus(path));
    }
  );

  server.registerTool(
    "get_attachment",
    {
      description:
        "Download one attachment from a message as base64. Identify by zero-based index (from get_message.attachments) or by filename. Size capped (default 5 MiB) to protect the MCP payload. Prefer index when filenames collide.",
      inputSchema: {
        mailbox: z.string(),
        uid: z.number().int().positive(),
        index: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Zero-based index in get_message attachments array"),
        filename: z
          .string()
          .optional()
          .describe("Exact filename match if index omitted"),
        max_bytes: z
          .number()
          .int()
          .positive()
          .max(15 * 1024 * 1024)
          .optional()
          .describe("Max decoded size in bytes (default 5242880)"),
        account: accountSchema,
      },
    },
    async ({ mailbox, uid, index, filename, max_bytes, account }) => {
      if (index === undefined && !filename) {
        return asJson({
          ok: false,
          error: "need_index_or_filename",
        });
      }
      const { imap } = pool.for(account);
      const result = await imap.getAttachment(mailbox, uid, {
        index,
        filename,
        maxBytes: max_bytes,
      });
      return asJson({ success: true, ...result });
    }
  );
}
