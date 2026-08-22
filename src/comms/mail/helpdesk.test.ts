import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clientNameFromHeaders, ticketFromHeaders, ticketNumberFrom } from "./helpdesk.js";
import { headerRecord } from "./imap.js";

describe("X-BWB headers", () => {
  it("prefers company header over customer id", () => {
    assert.equal(
      clientNameFromHeaders({
        "x-bwb-customerid": "C123",
        "x-bwb-customercompany": "Kinda - Angola",
      }),
      "Kinda - Angola"
    );
  });

  it("reads ticket number from X-BWB-TicketNumber", () => {
    assert.equal(ticketFromHeaders({ "x-bwb-ticketnumber": "2026081662000014" }), "2026081662000014");
    assert.equal(ticketNumberFrom("[Ticket#2026081662000014] aviso", ""), "2026081662000014");
  });

  it("parses raw RFC822 buffers", () => {
    const raw = Buffer.from(
      "X-BWB-TicketNumber: 2026081662000014\r\nX-BWB-CustomerCompany: Acme Lda\r\n\r\n"
    );
    const h = headerRecord(raw);
    assert.equal(h["x-bwb-ticketnumber"], "2026081662000014");
    assert.equal(clientNameFromHeaders(h), "Acme Lda");
  });
});
