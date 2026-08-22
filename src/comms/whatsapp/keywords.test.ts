import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { matchesAgtKeywords } from "./keywords.js";

describe("matchesAgtKeywords", () => {
  it("hits SAFT-AO and IVA", () => {
    assert.equal(matchesAgtKeywords("Erro no SAFT-AO do cliente"), true);
    assert.equal(matchesAgtKeywords("taxa de IVA 14%"), true);
  });

  it("hits faturação eletrónica variants", () => {
    assert.equal(matchesAgtKeywords("Faturação Eletrónica AGT"), true);
  });

  it("ignores unrelated chat", () => {
    assert.equal(matchesAgtKeywords("Bom dia, alguém vai almoçar?"), false);
  });
});
