import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { uniqueMatchingDest, type FolderRule } from "./match.js";

const rules: FolderRule[] = [
  {
    id: "1",
    accountId: "*",
    matchFrom: "acme@example.com",
    matchSubject: "",
    destFolder: "INBOX.acme",
  },
  {
    id: "2",
    accountId: "*",
    matchFrom: "acme@example.com",
    matchSubject: "urgente",
    destFolder: "INBOX.acme.urgent",
  },
];

describe("uniqueMatchingDest", () => {
  it("moves when a single dest matches", () => {
    const hit = uniqueMatchingDest(
      [rules[0]],
      { accountId: "a", fromHeader: "Acme <acme@example.com>", subject: "Olá" }
    );
    assert.deepEqual(hit, { destFolder: "INBOX.acme", ruleId: "1" });
  });

  it("does not move on conflicting dests", () => {
    const hit = uniqueMatchingDest(rules, {
      accountId: "a",
      fromHeader: "acme@example.com",
      subject: "urgente: stock",
    });
    assert.equal(hit, null);
  });
});
