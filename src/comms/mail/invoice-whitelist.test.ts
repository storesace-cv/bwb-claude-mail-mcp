import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  documentAccepted,
  foldText,
  shouldKeepInvoice,
} from "./invoice-whitelist.js";

describe("foldText", () => {
  it("treats joao and joão as equal", () => {
    assert.equal(foldText("João"), foldText("joao"));
  });
});

describe("documentAccepted", () => {
  const pdf = "Factura emitida por Jorge Peixinho para BWB Lda NIF 123";

  it("matches AND of two words on issuers", () => {
    assert.equal(documentAccepted(pdf, "Jorge&Peixinho", ""), true);
  });

  it("matches OR alternatives", () => {
    assert.equal(documentAccepted(pdf, "inexistente; peixinho", ""), true);
  });

  it("accepts if only recipient list matches", () => {
    assert.equal(documentAccepted(pdf, "acme", "bwb"), true);
  });

  it("rejects when neither list matches", () => {
    assert.equal(documentAccepted(pdf, "acme", "outro"), false);
  });

  it("rejects empty extract in active via shouldKeepInvoice", () => {
    assert.equal(shouldKeepInvoice("active", "", "jorge", "bwb"), false);
  });

  it("seed keeps even empty extract", () => {
    assert.equal(shouldKeepInvoice("seed", "", "jorge", ""), true);
  });

  it("review never keeps", () => {
    assert.equal(shouldKeepInvoice("review", pdf, "jorge&peixinho", "bwb"), false);
  });
});
