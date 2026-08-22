import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractPdfText, isInvoiceCandidate } from "./invoices.js";

describe("isInvoiceCandidate", () => {
  it("accepts factura PDF by name", () => {
    assert.equal(isInvoiceCandidate("Fatura-123.pdf", "application/pdf"), true);
  });

  it("accepts generic PDF", () => {
    assert.equal(isInvoiceCandidate("scan.pdf", "application/pdf"), true);
  });

  it("rejects calendar invites", () => {
    assert.equal(isInvoiceCandidate("invite.ics", "text/calendar"), false);
  });
});

describe("extractPdfText", () => {
  it("returns empty for non-pdf", () => {
    assert.equal(extractPdfText(Buffer.from("hello")), "");
  });
});
