import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyPromo } from "./classify-promo.js";

describe("classifyPromo", () => {
  it("files AlphaSignal as newsletter", () => {
    assert.equal(
      classifyPromo({ fromHeader: "Alpha <news@alphasignal.ai>", subject: "Daily" }),
      "newsletters"
    );
  });

  it("only moves Supabase monthly digest", () => {
    assert.equal(
      classifyPromo({ fromHeader: "welcome@supabase.com", subject: "Supa Update — August" }),
      "newsletters"
    );
    assert.equal(
      classifyPromo({ fromHeader: "welcome@supabase.com", subject: "Welcome to Pro" }),
      null
    );
  });

  it("keeps pCloud security mail", () => {
    assert.equal(
      classifyPromo({ fromHeader: "team@pcloud.com", subject: "Login alert" }),
      null
    );
  });

  it("moves pCloud promo", () => {
    assert.equal(
      classifyPromo({ fromHeader: "team@pcloud.email", subject: "50% off" }),
      "marketing"
    );
  });

  it("keeps Endesa invoices", () => {
    assert.equal(
      classifyPromo({ fromHeader: "no_reply@email.endesa.pt", subject: "A sua fatura" }),
      null
    );
  });

  it("never moves helpdesk", () => {
    assert.equal(
      classifyPromo({ fromHeader: "helpdesk@bwb.pt", subject: "Ticket#1 newsletter" }),
      null
    );
  });
});
