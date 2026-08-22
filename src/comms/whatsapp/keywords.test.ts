import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { matchesAgtKeywords, matchesKeywords } from "./keywords.js";

describe("matchesAgtKeywords", () => {
  it("hits SAFT-AO and IVA", () => {
    assert.equal(matchesAgtKeywords("Erro no SAFT-AO do cliente"), true);
    assert.equal(matchesAgtKeywords("taxa de IVA 14%"), true);
  });

  it("hits faturação eletrónica variants", () => {
    assert.equal(matchesAgtKeywords("Faturação Eletrónica AGT"), true);
  });

  it("matches configured keyword list", () => {
    assert.equal(matchesKeywords("novo SAFT-AO publicado", "faturação eletrónica, SAFT-AO"), true);
    assert.equal(matchesKeywords("Bom dia", "IVA, SAFT-AO"), false);
  });
});
