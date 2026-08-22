export interface FolderLayout {
  delimiter: string;
  inboxPrefix: boolean;
}

export function inferFolderLayout(paths: string[]): FolderLayout {
  const withInbox = paths.filter((p) => /^inbox([./])/i.test(p));
  const delim =
    withInbox.find((p) => p.includes(".")) && !withInbox.find((p) => /^inbox\//i.test(p))
      ? "."
      : withInbox.find((p) => p.includes("/"))
        ? "/"
        : paths.some((p) => p.includes("."))
          ? "."
          : "/";
  const inboxPrefix = paths.some((p) => /^inbox[./]/i.test(p));
  return { delimiter: delim, inboxPrefix };
}

export function sanitizeFolderSegment(name: string, delimiter: string): string {
  const re = new RegExp(`[./\\\\${delimiter === "." ? "" : delimiter}]`, "g");
  return name.replace(re, "-").replace(/\/+/g, "-").trim() || "_sem-nome";
}

export function folderPath(layout: FolderLayout, ...segments: string[]): string {
  const parts = layout.inboxPrefix ? ["INBOX", ...segments] : segments;
  return parts.join(layout.delimiter);
}
