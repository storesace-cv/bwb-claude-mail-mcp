import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyPromoWithRules } from "./classify-promo.js";
import { seedRulesAsMailRules } from "../rules/seed-initial.js";

const rules = seedRulesAsMailRules();

describe("classifyPromo", () => {
  it("files AlphaSignal as newsletter", () => {
    assert.equal(
      classifyPromoWithRules({ fromHeader: "Alpha <news@alphasignal.ai>", subject: "Daily" }, rules),
      "newsletters"
    );
  });

  it("only moves Supabase monthly digest", () => {
    assert.equal(
      classifyPromoWithRules(
        { fromHeader: "welcome@supabase.com", subject: "Supa Update — August" },
        rules
      ),
      "newsletters"
    );
    assert.equal(
      classifyPromoWithRules({ fromHeader: "welcome@supabase.com", subject: "Welcome to Pro" }, rules),
      null
    );
  });

  it("keeps pCloud security mail", () => {
    assert.equal(
      classifyPromoWithRules({ fromHeader: "team@pcloud.com", subject: "Login alert" }, rules),
      null
    );
  });

  it("moves pCloud promo", () => {
    assert.equal(
      classifyPromoWithRules({ fromHeader: "team@pcloud.email", subject: "50% off" }, rules),
      "marketing"
    );
  });

  it("keeps Endesa invoices", () => {
    assert.equal(
      classifyPromoWithRules(
        { fromHeader: "no_reply@email.endesa.pt", subject: "A sua fatura" },
        rules
      ),
      null
    );
  });

  it("never moves helpdesk", () => {
    assert.equal(
      classifyPromoWithRules(
        { fromHeader: "helpdesk@bwb.pt", subject: "Ticket#1 newsletter" },
        rules
      ),
      null
    );
  });
});
