import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { folderPath, inferFolderLayout, sanitizeFolderSegment } from "./folders.js";

describe("inferFolderLayout", () => {
  it("uses dot children of INBOX", () => {
    const l = inferFolderLayout(["INBOX", "INBOX.Sent", "INBOX.Drafts"]);
    assert.equal(l.delimiter, ".");
    assert.equal(l.inboxPrefix, true);
    assert.equal(folderPath(l, "helpdesk", "Kinda - Angola"), "INBOX.helpdesk.Kinda - Angola");
  });

  it("uses slash when folders are siblings of Inbox", () => {
    const l = inferFolderLayout(["Inbox", "Sent", "Drafts"]);
    assert.equal(l.inboxPrefix, false);
    assert.equal(folderPath(l, "helpdesk", "Kinda"), "helpdesk/Kinda");
  });
});

describe("sanitizeFolderSegment", () => {
  it("replaces delimiter and slash", () => {
    assert.equal(sanitizeFolderSegment("A/B.C", "."), "A-B-C");
  });
});
